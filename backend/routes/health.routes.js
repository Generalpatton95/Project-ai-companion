import { Router } from 'express';

export const healthRoutes = Router();

healthRoutes.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'AI Gaming Companion',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

healthRoutes.get('/api/v1/status', (req, res) => {
  res.json({ version: 'v1', status: 'operational' });
});
