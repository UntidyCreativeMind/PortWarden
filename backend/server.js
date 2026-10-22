import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

import apiRoutes from './routes/api.js';

app.disable('x-powered-by');

// Middleware
// No CORS: the frontend is served from this same origin (and proxied by Vite in dev)
app.use(express.json({ limit: '1mb' }));

// Basic security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    next();
});

// Basic health check route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'PortWarden API is running' });
});

// Routes
app.use('/api', apiRoutes);

// Unknown API routes return JSON, not the SPA
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Serve frontend in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, '../frontend/dist');

app.use(express.static(frontendPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
