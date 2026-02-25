import axios from 'axios';
import db from '../database.js';

class PortainerService {
    async getContainers() {
        const settings = db.getSettings();
        let { portainer_url, portainer_token } = settings;

        if (!portainer_url) {
            return []; // Return empty if not configured
        }

        // Strip trailing slash
        if (portainer_url.endsWith('/')) {
            portainer_url = portainer_url.slice(0, -1);
        }

        try {
            // We will need to query the Portainer API
            // A common route to get all containers across all endpoints is more complex.
            // Usually, we select the primary local endpoint (e.g., endpoint ID 1 or 2).
            // Let's fetch endpoints first to find the active ones.

            const config = {
                headers: {
                    'X-API-Key': portainer_token
                }
            };

            const endpointsRes = await axios.get(`${portainer_url}/api/endpoints`, config);
            const endpoints = endpointsRes.data;

            const allContainers = [];

            for (const endpoint of endpoints) {
                if (endpoint.Status === 1) { // 1 = Up
                    try {
                        const containersRes = await axios.get(`${portainer_url}/api/endpoints/${endpoint.Id}/docker/containers/json`, config);
                        const containers = containersRes.data;

                        for (const container of containers) {
                            const name = container.Names[0].startsWith('/') ? container.Names[0].substring(1) : container.Names[0];
                            const ports = container.Ports || [];

                            allContainers.push({
                                id: container.Id,
                                name,
                                state: container.State,
                                endpointId: endpoint.Id,
                                endpointName: endpoint.Name,
                                ports: ports.map(p => ({
                                    ip: p.IP,
                                    privatePort: p.PrivatePort,
                                    publicPort: p.PublicPort,
                                    type: p.Type
                                }))
                            });
                        }
                    } catch (err) {
                        console.error(`Failed to fetch containers for endpoint ${endpoint.Name}:`, err.message);
                    }
                }
            }

            return allContainers;

        } catch (err) {
            console.error('Failed to fetch from Portainer:', err.message);
            throw new Error('Portainer API Error: ' + err.message);
        }
    }
}

export default new PortainerService();
