import { Client } from 'ssh2';
import db from '../database.js';
import fs from 'fs';

class SSHService {
    constructor() {
        this.client = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            const settings = db.getSettings();
            const { host_ip, ssh_username, ssh_password, ssh_key_path } = settings;

            if (!host_ip || !ssh_username) {
                return reject(new Error('SSH settings incomplete: Host IP and Username are required'));
            }

            const connectOptions = {
                host: host_ip,
                port: 22,
                username: ssh_username
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

            this.client = new Client();

            this.client.on('ready', () => {
                resolve();
            }).on('error', (err) => {
                reject(err);
            }).connect(connectOptions);
        });
    }

    async execute(command) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                return reject(new Error('Not connected to SSH'));
            }

            this.client.exec(command, (err, stream) => {
                if (err) return reject(err);

                let output = '';
                let errorOutput = '';

                stream.on('close', (code, signal) => {
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

    disconnect() {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }

    async getUFWStatus() {
        try {
            await this.connect();
            // Need sudo if connecting as non-root, but we assume root or passwordless sudo for simplicity
            // UFW requires root privileges.
            const output = await this.execute('ufw status numbered');
            this.disconnect();
            return this.parseUFWStatus(output);
        } catch (err) {
            if (this.client) this.disconnect();
            throw err;
        }
    }

    parseUFWStatus(output) {
        const lines = output.split('\\n');
        const rules = [];
        let isActive = false;

        for (const line of lines) {
            if (line.includes('Status: active')) {
                isActive = true;
            }
            // Match rules like: [ 1] 80/tcp  ALLOW IN  Anywhere
            const match = line.match(/^\\[\\s*(\\d+)\\]\\s+(\\S+)\\s+([A-Z\\s]+)\\s+(.*)$/);
            if (match) {
                const portProto = match[2];
                let port, protocol = 'Any';
                if (portProto.includes('/')) {
                    [port, protocol] = portProto.split('/');
                } else {
                    port = portProto;
                }

                rules.push({
                    id: parseInt(match[1]),
                    to: port,
                    protocol: protocol,
                    action: match[3].trim(),
                    from: match[4].trim()
                });
            }
        }

        return { active: isActive, rules };
    }

    async addUFWRule(port, protocol) {
        try {
            await this.connect();
            const protoSuffix = protocol && protocol !== 'Any' ? `/${protocol}` : '';
            await this.execute(`ufw allow ${port}${protoSuffix}`);
            this.disconnect();
        } catch (err) {
            if (this.client) this.disconnect();
            throw err;
        }
    }

    async deleteUFWRule(ruleId) {
        try {
            await this.connect();
            // The output of \`ufw delete X\` expects a "y" confirmation. 
            // We can use \`--force\` to bypass it: \`ufw --force delete X\`
            await this.execute(`ufw --force delete ${ruleId}`);
            this.disconnect();
        } catch (err) {
            if (this.client) this.disconnect();
            throw err;
        }
    }

    async getOpenPorts() {
        try {
            await this.connect();
            // Get listening sockets. 
            // ss -tulpn output looks like:
            // Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
            // tcp   LISTEN 0      4096   0.0.0.0:80         0.0.0.0:*         users:(("nginx",pid=123,fd=4))
            const output = await this.execute('ss -tulpn');
            this.disconnect();
            return this.parseSSOutput(output);
        } catch (err) {
            if (this.client) this.disconnect();
            throw err;
        }
    }

    parseSSOutput(output) {
        const lines = output.split('\\n').filter(l => l.trim() !== '' && !l.includes('Netid'));
        const ports = [];

        for (const line of lines) {
            // Very basic regex to split by whitespace but keep the final column together
            const parts = line.trim().split(/\\s+/);
            if (parts.length >= 6) {
                const netid = parts[0]; // tcp or udp
                const state = parts[1]; // Should be LISTEN for tcp or UNCONN for udp
                if (state !== 'LISTEN' && state !== 'UNCONN') continue;

                const localAddressPort = parts[4]; // e.g. 0.0.0.0:80 or 127.0.0.1:22
                const lastColonIdx = localAddressPort.lastIndexOf(':');
                if (lastColonIdx === -1) continue;

                const port = localAddressPort.substring(lastColonIdx + 1);

                let processInfo = parts.slice(6).join(' '); // Process info might have spaces

                ports.push({
                    protocol: netid,
                    port: parseInt(port),
                    process: processInfo
                });
            }
        }
        return ports;
    }
}

export default new SSHService();
