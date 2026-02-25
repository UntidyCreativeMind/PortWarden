import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

import apiRoutes from './routes/api.js';

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

// Basic health check route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'PortWarden API is running' });
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
