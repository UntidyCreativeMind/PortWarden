import { Client, utils as sshUtils } from 'ssh2';
import db, { dataDir } from '../database.js';
import fs from 'fs';
import path from 'path';
import { parsePort, parseRuleId, PROTOCOLS } from '../security.js';

// PortWarden's own SSH key pair, kept in the data volume so nothing has to be mounted.
// Its public key is shown in Settings to be added to the host's authorized_keys.
export const MANAGED_KEY_PATH = path.join(dataDir, 'ssh', 'id_ed25519');
const LEGACY_KEY_PATHS = ['/root/.ssh/id_rsa', '/root/.ssh/id_ed25519'];

const ensureManagedKey = () => {
    if (!fs.existsSync(MANAGED_KEY_PATH)) {
        fs.mkdirSync(path.dirname(MANAGED_KEY_PATH), { recursive: true, mode: 0o700 });
        const keys = sshUtils.generateKeyPairSync('ed25519', { comment: 'portwarden' });
        fs.writeFileSync(MANAGED_KEY_PATH, keys.private, { mode: 0o600 });
        fs.writeFileSync(`${MANAGED_KEY_PATH}.pub`, `${keys.public}\n`, { mode: 0o644 });
        console.log('Generated PortWarden SSH key. Copy the public key from Settings to the host.');
    }

    // Older installs pointed at a mounted ~/.ssh key; switch them over once that mount is gone
    const { ssh_key_path } = db.getSettings();
    if (LEGACY_KEY_PATHS.includes(ssh_key_path) && !fs.existsSync(ssh_key_path)) {
        db.updateSetting('ssh_key_path', MANAGED_KEY_PATH);
    }
};
ensureManagedKey();

export const getManagedPublicKey = () => {
    try {
        return fs.readFileSync(`${MANAGED_KEY_PATH}.pub`, 'utf8').trim();
    } catch {
        return null;
    }
};

// Protocols an inbound ALLOW rule opens, or [] if the rule isn't one for a single port
export const ruleProtocols = (rule) => {
    if (rule.action !== 'ALLOW' || rule.direction !== 'IN' || !/^\d+$/.test(rule.to)) return [];
    return rule.protocol === 'Any' ? [...PROTOCOLS] : PROTOCOLS.filter(p => p === rule.protocol);
};

class SSHService {
    // Opens a connection, runs fn(exec), and always closes the connection afterwards
    async withConnection(fn) {
        const client = await this.connect();
        try {
            return await fn((command) => this.execute(client, command));
        } finally {
            client.end();
        }
    }

    connect() {
        return new Promise((resolve, reject) => {
            const settings = db.getSettings();
            const { host_ip, ssh_username, ssh_password, ssh_key_path, ssh_host_fingerprint } = settings;

            if (!host_ip || !ssh_username) {
                return reject(new Error('SSH settings incomplete: Host IP and Username are required'));
            }

            let hostKeyRejected = false;
            const connectOptions = {
                host: host_ip,
                port: 22,
                username: ssh_username,
                readyTimeout: 10000,
                // Trust-on-first-use host key pinning: remember the host's key fingerprint
                // on the first connection and refuse to connect if it ever changes.
                hostHash: 'sha256',
                hostVerifier: (fingerprint) => {
                    if (!ssh_host_fingerprint) {
                        db.updateSetting('ssh_host_fingerprint', fingerprint);
                        return true;
                    }
                    hostKeyRejected = fingerprint !== ssh_host_fingerprint;
                    return !hostKeyRejected;
                }
            };

            if (ssh_password) {
                connectOptions.password = ssh_password;
            } else if (ssh_key_path) {
                try {
                    connectOptions.privateKey = fs.readFileSync(ssh_key_path);
                } catch (err) {
                    return reject(new Error(`Failed to read SSH key at ${ssh_key_path}`));
                }
            } else {
                return reject(new Error('SSH settings incomplete: Password or Key Path missing'));
            }

            const client = new Client();

            client.on('ready', () => {
                resolve(client);
            }).on('error', (err) => {
                if (hostKeyRejected) {
                    return reject(new Error('SSH host key does not match the pinned key. If the host was legitimately reinstalled, reset the pinned key in Settings.'));
                }
                reject(err);
            }).connect(connectOptions);
        });
    }

    execute(client, command) {
        return new Promise((resolve, reject) => {
            client.exec(command, (err, stream) => {
                if (err) return reject(err);

                let output = '';
                let errorOutput = '';

                stream.on('close', (code) => {
                    if (code !== 0) {
                        // Sometime UFW commands output to stderr, sometimes to stdout even if failed.
                        return reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`));
                    }
                    resolve(output);
                }).on('data', (data) => {
                    output += data;
                }).stderr.on('data', (data) => {
                    errorOutput += data;
                });
            });
        });
    }

    async getUFWStatus() {
        const output = await this.withConnection((exec) => exec('sudo -n ufw status numbered'));
        return this.parseUFWStatus(output);
    }

    parseUFWStatus(output) {
        const lines = output.split('\n');
        const rules = [];
        let isActive = false;

        for (const line of lines) {
            if (line.includes('Status: active')) {
                isActive = true;
            }
            // Match rules like:
            //   [ 1] 80/tcp                     ALLOW IN    Anywhere
            //   [ 2] 80/tcp (v6)                ALLOW IN    Anywhere (v6)
            //   [ 3] 8080 on eth0               DENY IN     192.168.1.0/24
            const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s+(.*)$/);
            if (!match) continue;

            let to = match[2].trim();
            const v6 = to.includes('(v6)');
            to = to.replace(/\(v6\)/g, '').replace(/\s+on\s+\S+/, '').trim();

            let port = to, protocol = 'Any';
            if (to.includes('/')) {
                [port, protocol] = to.split('/');
            }

            rules.push({
                id: parseInt(match[1]),
                to: port,
                protocol: protocol.toLowerCase() === 'any' ? 'Any' : protocol.toLowerCase(),
                action: match[3],
                direction: match[4] || 'IN',
                from: match[5].trim(),
                v6
            });
        }

        return { active: isActive, rules };
    }

    // Make UFW allow exactly the requested protocols ({ tcp: bool, udp: bool }) for a port.
    // Removes any ALLOW rules that open protocols that should now be blocked, then adds
    // a rule for anything still missing. When both protocols are wanted, a single
    // protocol-less rule (`ufw allow <port>`) is used instead of separate tcp/udp rules.
    async setPortRules(portValue, desired) {
        const port = parsePort(portValue);
        if (port === null) throw new Error('Invalid port');
        const want = {
            tcp: desired?.tcp === true,
            udp: desired?.udp === true
        };
        const wantBoth = want.tcp && want.udp;

        return this.withConnection(async (exec) => {
            const { rules } = this.parseUFWStatus(await exec('sudo -n ufw status numbered'));
            const portRules = rules.filter(r => parseInt(r.to) === port && ruleProtocols(r).length > 0);

            // Delete rules that open an unwanted protocol, highest number first so numbering stays valid.
            // When allowing both, also fold unrestricted per-protocol rules into one combined rule
            // (rules limited to a specific source are left alone).
            const toDelete = portRules
                .filter(r => ruleProtocols(r).some(p => !want[p])
                    || (wantBoth && r.protocol !== 'Any' && r.from.startsWith('Anywhere')))
                .sort((a, b) => b.id - a.id);
            for (const rule of toDelete) {
                const id = parseRuleId(rule.id);
                if (id === null) continue;
                await exec(`sudo -n ufw --force delete ${id}`);
            }

            const remaining = portRules.filter(r => !toDelete.includes(r));
            if (wantBoth) {
                if (!remaining.some(r => r.protocol === 'Any')) {
                    await exec(`sudo -n ufw allow ${port}`);
                }
                return;
            }

            const covered = new Set(remaining.flatMap(r => ruleProtocols(r)));
            for (const proto of PROTOCOLS) {
                if (want[proto] && !covered.has(proto)) {
                    await exec(`sudo -n ufw allow ${port}/${proto}`);
                }
            }
        });
    }

    async getOpenPorts() {
        // Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
        // tcp   LISTEN 0      4096   0.0.0.0:80         0.0.0.0:*         users:(("nginx",pid=123,fd=4))
        const output = await this.withConnection((exec) => exec('sudo -n ss -tulpn'));
        return this.parseSSOutput(output);
    }

    parseSSOutput(output) {
        const lines = output.split('\n').filter(l => l.trim() !== '' && !l.includes('Netid'));
        const ports = [];

        for (const line of lines) {
            // Very basic regex to split by whitespace but keep the final column together
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 6) {
                const netid = parts[0]; // tcp or udp
                const state = parts[1]; // Should be LISTEN for tcp or UNCONN for udp
                if (state !== 'LISTEN' && state !== 'UNCONN') continue;

                const localAddressPort = parts[4]; // e.g. 0.0.0.0:80 or 127.0.0.1:22
                const lastColonIdx = localAddressPort.lastIndexOf(':');
                if (lastColonIdx === -1) continue;

                const port = parseInt(localAddressPort.substring(lastColonIdx + 1));
                if (isNaN(port)) continue;

                let processInfo = parts.slice(6).join(' '); // Process info might have spaces

                ports.push({
                    protocol: netid.startsWith('udp') ? 'udp' : 'tcp',
                    port,
                    process: processInfo
                });
            }
        }
        return ports;
    }
}

export default new SSHService();
