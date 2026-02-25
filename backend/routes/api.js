import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../database.js';
import sshService from '../services/ssh.js';
import portainerService from '../services/portainer.js';

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
        const ufwStatus = await sshService.getUFWStatus();

        // 2. Get Host Open Ports
        const openPorts = await sshService.getOpenPorts();

        // 3. Get Docker Containers
        let containers = [];
        try {
            containers = await portainerService.getContainers();
        } catch (e) {
            console.error('Failed to get Portainer containers (may not be configured):', e.message);
        }

        // 4. Get Custom Names
        const customNames = db.getCustomNames();

        // 5. Cross reference
        // Create a map of port to enrichment data
        const portMap = new Map();

        // Initialize with open ports on host
        for (const op of openPorts) {
            const key = `${op.port}-${op.protocol}`;
            portMap.set(key, {
                port: op.port,
                protocol: op.protocol,
                state: 'open on host',
                process: op.process,
                docker: null,
                ufwRules: [],
                customName: customNames.find(c => c.port === op.port && (c.protocol === op.protocol || c.protocol === 'Any'))?.name || null
            });
        }

        // Map Docker containers to ports
        for (const container of containers) {
            for (const p of container.ports) {
                if (p.publicPort) {
                    const key = `${p.publicPort}-${p.type}`; // type is usually tcp or udp
                    const info = portMap.get(key) || {
                        port: p.publicPort,
                        protocol: p.type,
                        state: 'open in docker',
                        process: null,
                        docker: null,
                        ufwRules: [],
                        customName: customNames.find(c => c.port === p.publicPort && (c.protocol === p.type || c.protocol === 'Any'))?.name || null
                    };

                    info.docker = {
                        id: container.id,
                        name: container.name,
                        endpoint: container.endpointName
                    };

                    portMap.set(key, info);
                }
            }
        }

        // Attach UFW rules
        for (const rule of ufwStatus.rules) {
            const portInt = parseInt(rule.to);
            if (isNaN(portInt)) continue; // skip complex rules for now

            const protocols = rule.protocol === 'Any' ? ['tcp', 'udp'] : [rule.protocol.toLowerCase()];

            for (const proto of protocols) {
                const key = `${portInt}-${proto}`;
                const info = portMap.get(key) || {
                    port: portInt,
                    protocol: proto,
                    state: 'ufw only',
                    process: null,
                    docker: null,
                    ufwRules: [],
                    customName: customNames.find(c => c.port === portInt && (c.protocol === proto || c.protocol === 'Any'))?.name || null
                };

                info.ufwRules.push(rule);
                portMap.set(key, info);
            }
        }

        const result = Array.from(portMap.values());
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
