import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../database.js';
import sshService from '../services/ssh.js';
import dockerService from '../services/docker.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_temporary_key_for_dev';

// Auth middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// --- AUTH ROUTES ---

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.getUser(username);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const [salt, hash] = user.password_hash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

    if (hash !== verifyHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
});

router.post('/change-password', authenticate, (req, res) => {
    const { newPassword } = req.body;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
    const password_hash = `${salt}:${hash}`;

    db.updatePassword(req.user.username, password_hash);
    res.json({ success: true });
});

// --- SETTINGS ROUTES ---

router.get('/settings', authenticate, (req, res) => {
    res.json(db.getSettings());
});

router.post('/settings', authenticate, (req, res) => {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
        db.updateSetting(key, value);
    }
    res.json({ success: true });
});

// --- LOGIC ROUTES ---

router.get('/ports', authenticate, async (req, res) => {
    try {
        // 1. Get UFW rules
        let ufwStatus = { active: false, rules: [] };
        try {
            ufwStatus = await sshService.getUFWStatus();
        } catch (e) {
            console.error('SSH Error getting UFW status:', e.message);
        }

        // 2. Get Host Open Ports
        let openPorts = [];
        try {
            openPorts = await sshService.getOpenPorts();
        } catch (e) {
            console.error('SSH Error getting Open Ports:', e.message);
        }

        // 3. Get Docker Containers
        let containers = [];
        try {
            containers = await dockerService.getContainers();
        } catch (e) {
            console.error('Failed to get Docker containers (check socket mount):', e.message);
        }

        // 4. Get Custom Names
        const customNames = db.getCustomNames();

        // 5. Cross reference
        const portMap = new Map();

        const getInfo = (portStr) => {
            const port = parseInt(portStr);
            const key = `${port}`;
            if (!portMap.has(key)) {
                portMap.set(key, {
                    port: port,
                    protocols: [],
                    state: 'inactive',
                    processes: [],
                    docker: null,
                    ufwRules: [],
                    customName: customNames.find(c => c.port === port)?.name || null
                });
            }
            return portMap.get(key);
        };

        // Host open ports
        for (const op of openPorts) {
            const info = getInfo(op.port);
            if (!info.protocols.includes(op.protocol)) info.protocols.push(op.protocol);
            if (op.process && !info.processes.includes(op.process)) info.processes.push(op.process);
            info.state = 'open on host';
        }

        // Map Docker containers to ports
        for (const container of containers) {
            for (const p of container.ports) {
                if (p.publicPort) {
                    const info = getInfo(p.publicPort);
                    if (!info.protocols.includes(p.type)) info.protocols.push(p.type);
                    info.state = 'open in docker';
                    info.docker = {
                        id: container.id,
                        name: container.name,
                        endpoint: container.endpointName
                    };
                }
            }
        }

        // Attach UFW rules
        for (const rule of ufwStatus.rules) {
            let toStr = rule.to || '';
            let parsedPort = parseInt(toStr.replace(/\(v6\)/g, '').trim());
            if (isNaN(parsedPort)) continue;

            const info = getInfo(parsedPort);
            info.ufwRules.push(rule);
            if (info.state === 'inactive') info.state = 'ufw only';
        }

        // Finalize for dashboard
        const result = Array.from(portMap.values()).map(r => ({
            ...r,
            protocol: r.protocols.length === 0 ? 'Any' : (r.protocols.length > 1 ? 'Any' : r.protocols[0]),
            process: r.processes.join(', ') || null
        }));

        res.json({
            ufwActive: ufwStatus.active,
            ports: result
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom-name', authenticate, (req, res) => {
    const { port, protocol, name } = req.body;
    if (name) {
        db.setCustomName(port, protocol, name);
    } else {
        db.deleteCustomName(port, protocol);
    }
    res.json({ success: true });
});

// --- UFW ROUTES ---

router.post('/ufw/allow', authenticate, async (req, res) => {
    const { port, protocol } = req.body;
    try {
        await sshService.addUFWRule(port, protocol);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/ufw/delete', authenticate, async (req, res) => {
    const { ruleId } = req.body; // Needs the UFW rule ID from ufw status numbered
    try {
        await sshService.deleteUFWRule(ruleId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
