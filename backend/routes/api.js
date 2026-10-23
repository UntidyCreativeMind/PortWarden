import express from 'express';
import jwt from 'jsonwebtoken';
import db, { EDITABLE_SETTINGS } from '../database.js';
import sshService, { ruleProtocols, getManagedPublicKey, MANAGED_KEY_PATH } from '../services/ssh.js';
import dockerService from '../services/docker.js';
import {
    hashPassword, verifyPassword, needsRehash, MIN_PASSWORD_LENGTH,
    parsePort, PROTOCOLS, loginRateLimit
} from '../security.js';

const router = express.Router();

const MAX_NAME_LENGTH = 64;
const BACKUP_VERSION = 1;

// Auth middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, db.jwtSecret, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const cleanName = (name) => {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
};

// --- AUTH ROUTES ---

router.post('/login', (req, res) => {
    const ip = req.ip;
    if (loginRateLimit.isBlocked(ip)) {
        return res.status(429).json({ error: 'Too many failed login attempts. Try again in 15 minutes.' });
    }

    const { username, password } = req.body;
    const user = typeof username === 'string' ? db.getUser(username) : null;

    if (!user || !verifyPassword(password, user.password_hash)) {
        loginRateLimit.recordFailure(ip);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginRateLimit.reset(ip);

    // Upgrade hashes created by older versions to the current iteration count
    if (needsRehash(user.password_hash)) {
        db.updatePassword(user.username, hashPassword(password));
    }

    const token = jwt.sign({ id: user.id, username: user.username }, db.jwtSecret, { expiresIn: '24h' });
    res.json({ token });
});

router.post('/change-password', authenticate, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = db.getUser(req.user.username);

    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    db.updatePassword(req.user.username, hashPassword(newPassword));
    res.json({ success: true });
});

// --- SETTINGS ROUTES ---

// The SSH password is never sent back to the browser; only whether one is set
router.get('/settings', authenticate, (req, res) => {
    const settings = db.getSettings();
    res.json({
        host_ip: settings.host_ip || '',
        ssh_username: settings.ssh_username || '',
        ssh_key_path: settings.ssh_key_path || '',
        ssh_password_set: !!settings.ssh_password,
        ssh_host_fingerprint: settings.ssh_host_fingerprint || null,
        ssh_public_key: getManagedPublicKey(),
        managed_key_path: MANAGED_KEY_PATH
    });
});

router.post('/settings', authenticate, (req, res) => {
    const current = db.getSettings();
    const updates = {};

    for (const key of EDITABLE_SETTINGS) {
        const value = req.body[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.length > 4096) {
            return res.status(400).json({ error: `Invalid value for ${key}` });
        }
        // A blank password field means "keep the existing password"
        if (key === 'ssh_password' && value === '') continue;
        updates[key] = key === 'ssh_password' ? value : value.trim();
    }
    if (req.body.clear_ssh_password === true) {
        updates.ssh_password = '';
    }

    for (const [key, value] of Object.entries(updates)) {
        db.updateSetting(key, value);
    }

    // A different host means a different host key; re-pin on next connection
    if (updates.host_ip !== undefined && updates.host_ip !== current.host_ip) {
        db.updateSetting('ssh_host_fingerprint', '');
    }

    res.json({ success: true });
});

router.post('/settings/reset-host-key', authenticate, (req, res) => {
    db.updateSetting('ssh_host_fingerprint', '');
    res.json({ success: true });
});

// --- LOGIC ROUTES ---

router.get('/ports', authenticate, async (req, res) => {
    try {
        // 1. Get UFW rules
        let ufwStatus = { active: false, rules: [] };
        const errors = [];
        try {
            ufwStatus = await sshService.getUFWStatus();
        } catch (e) {
            console.error('SSH Error getting UFW status:', e.message);
            errors.push(`UFW: ${e.message}`);
        }

        // 2. Get Host Open Ports
        let openPorts = [];
        try {
            openPorts = await sshService.getOpenPorts();
        } catch (e) {
            console.error('SSH Error getting Open Ports:', e.message);
            errors.push(`Open ports: ${e.message}`);
        }

        // 3. Get Docker Containers
        let containers = [];
        try {
            containers = await dockerService.getContainers();
        } catch (e) {
            console.error('Failed to get Docker containers (check socket mount):', e.message);
            errors.push(`Docker: ${e.message}`);
        }

        // 4. Get Custom Names
        const customNames = db.getCustomNames();

        // 5. Cross reference
        const portMap = new Map();

        const getInfo = (port) => {
            if (!portMap.has(port)) {
                portMap.set(port, {
                    port,
                    listening: { tcp: false, udp: false },
                    allowed: { tcp: false, udp: false },
                    state: 'inactive',
                    processes: [],
                    docker: null,
                    ufwRules: [],
                    customName: customNames.find(c => c.port === port)?.name || null
                });
            }
            return portMap.get(port);
        };

        // Host open ports
        for (const op of openPorts) {
            const info = getInfo(op.port);
            info.listening[op.protocol] = true;
            if (op.process && !info.processes.includes(op.process)) info.processes.push(op.process);
            info.state = 'open on host';
        }

        // Map Docker containers to ports
        for (const container of containers) {
            for (const p of container.ports) {
                if (p.publicPort) {
                    const info = getInfo(p.publicPort);
                    if (PROTOCOLS.includes(p.type)) info.listening[p.type] = true;
                    info.state = 'open in docker';
                    info.docker = {
                        id: container.id,
                        name: container.name,
                        endpoint: container.endpointName
                    };
                }
            }
        }

        // Attach UFW rules (single-port rules only; ranges and app profiles are skipped)
        for (const rule of ufwStatus.rules) {
            if (!/^\d+$/.test(rule.to)) continue;
            const info = getInfo(parseInt(rule.to));
            info.ufwRules.push(rule);
            for (const proto of ruleProtocols(rule)) info.allowed[proto] = true;
            if (info.state === 'inactive') info.state = 'ufw only';
        }

        // Finalize for dashboard
        const result = Array.from(portMap.values()).map(({ processes, ...r }) => ({
            ...r,
            process: processes.join(', ') || null
        }));

        res.json({
            ufwActive: ufwStatus.active,
            ports: result,
            errors
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom-name', authenticate, (req, res) => {
    const port = parsePort(req.body.port);
    if (port === null) return res.status(400).json({ error: 'Invalid port' });

    const { name } = req.body;
    if (name === undefined || name === null || (typeof name === 'string' && name.trim() === '')) {
        db.deleteCustomName(port);
        return res.json({ success: true });
    }

    const cleaned = cleanName(name);
    if (cleaned === null) {
        return res.status(400).json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` });
    }
    db.setCustomName(port, cleaned);
    res.json({ success: true });
});

// --- UFW ROUTES ---

// Set which protocols UFW allows for a port: { port, tcp: bool, udp: bool }
router.post('/ufw/set', authenticate, async (req, res) => {
    const port = parsePort(req.body.port);
    if (port === null) return res.status(400).json({ error: 'Invalid port' });
    if (typeof req.body.tcp !== 'boolean' || typeof req.body.udp !== 'boolean') {
        return res.status(400).json({ error: 'tcp and udp must be booleans' });
    }

    try {
        await sshService.setPortRules(port, { tcp: req.body.tcp, udp: req.body.udp });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- BACKUP / RESTORE ---

// Backups hold custom names and non-secret connection settings. The SSH password,
// JWT secret and user accounts are deliberately left out.
router.get('/backup', authenticate, (req, res) => {
    const settings = db.getSettings();
    const backup = {
        app: 'PortWarden',
        backupVersion: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        customNames: db.getCustomNames(),
        settings: {
            host_ip: settings.host_ip || '',
            ssh_username: settings.ssh_username || '',
            ssh_key_path: settings.ssh_key_path || ''
        }
    };
    const date = backup.createdAt.slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="portwarden-backup-${date}.json"`);
    res.json(backup);
});

// Body: { backup, mode: 'merge' | 'replace', includeSettings: bool }
router.post('/restore', authenticate, (req, res) => {
    const { backup, mode = 'merge', includeSettings = false } = req.body;

    if (!backup || backup.app !== 'PortWarden' || !Array.isArray(backup.customNames)) {
        return res.status(400).json({ error: 'Not a PortWarden backup file' });
    }
    if (typeof backup.backupVersion !== 'number' || backup.backupVersion > BACKUP_VERSION) {
        return res.status(400).json({ error: 'Backup was made by a newer version of PortWarden' });
    }
    if (mode !== 'merge' && mode !== 'replace') {
        return res.status(400).json({ error: 'Invalid restore mode' });
    }

    const names = [];
    let skipped = 0;
    for (const entry of backup.customNames) {
        const port = parsePort(entry?.port);
        const name = cleanName(entry?.name);
        if (port === null || name === null) {
            skipped++;
            continue;
        }
        names.push({ port, name });
    }

    db.importCustomNames(names, mode === 'replace');

    let settingsRestored = false;
    if (includeSettings && backup.settings && typeof backup.settings === 'object') {
        const current = db.getSettings();
        for (const key of ['host_ip', 'ssh_username', 'ssh_key_path']) {
            const value = backup.settings[key];
            if (typeof value === 'string' && value.length <= 4096) {
                db.updateSetting(key, value.trim());
                settingsRestored = true;
            }
        }
        if (db.getSettings().host_ip !== current.host_ip) {
            db.updateSetting('ssh_host_fingerprint', '');
        }
    }

    res.json({ success: true, restored: names.length, skipped, settingsRestored });
});

export default router;
