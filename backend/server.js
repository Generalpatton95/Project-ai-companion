// ============================================================================
// FILE: backend/server.js
// Main Server Entry Point
// ============================================================================

const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const { errorMiddleware } = require('./middleware/error.middleware');

// Import routes
const agentRoutes = require('./routes/agent.routes');
const { createSafeguardsRouter } = require('./routes/safeguards.routes');
// Add other routes as you create them
// const authRoutes = require('./routes/auth.routes');
// const userRoutes = require('./routes/user.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info('Request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/agent', agentRoutes);
app.use('/api/safeguards', createSafeguardsRouter());
// app.use('/api/auth', authRoutes);
// app.use('/api/users', userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (must be last)
app.use(errorMiddleware);

// Start server
const PORT = config.app.port;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.app.env}`);
});

module.exports = app;
