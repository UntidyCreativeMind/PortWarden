import Docker from 'dockerode';
import fs from 'fs';

class DockerService {
    constructor() {
        // Use DOCKER_HOST when set; otherwise the local socket if it's mounted, otherwise the
        // read-only socket proxy service from docker-compose.yml (reachable as "docker-proxy")
        if (process.env.DOCKER_HOST) {
            this.docker = new Docker();
        } else if (fs.existsSync('/var/run/docker.sock')) {
            this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        } else {
            this.docker = new Docker({ host: 'docker-proxy', port: 2375, protocol: 'http' });
        }
    }

    async getContainers() {
        try {
            // Get all containers including stopped ones (optional: pass { all: true } inside listContainers)
            const containers = await this.docker.listContainers({ all: true });
            const allContainers = [];

            for (const container of containers) {
                // Names come with a leading slash, e.g., '/my-container'
                const name = container.Names && container.Names.length > 0 
                    ? (container.Names[0].startsWith('/') ? container.Names[0].substring(1) : container.Names[0])
                    : 'unknown';
                
                const ports = container.Ports || [];

                // Standardize state mapping ('running', 'exited', etc.)
                allContainers.push({
                    id: container.Id,
                    name,
                    state: container.State,
                    endpointId: 1, // Mock endpoint ID since we query natively
                    endpointName: 'Local Docker',
                    ports: ports.map(p => ({
                        ip: p.IP || '0.0.0.0',
                        privatePort: p.PrivatePort,
                        publicPort: p.PublicPort,
                        type: p.Type // 'tcp' or 'udp'
                    }))
                });
            }

            return allContainers;
        } catch (err) {
            console.error('Failed to fetch from Docker socket:', err.message);
            throw new Error('Docker API Error: ' + err.message);
        }
    }
}

export default new DockerService();
