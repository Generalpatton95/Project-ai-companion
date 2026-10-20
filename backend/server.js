// ============================================================================
// FILE: backend/server.js
// Main Server Entry Point
// ============================================================================

const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const { errorMiddleware } = require('./middleware/error.middleware');
const { requestLogMiddleware } = require('./middleware/request-log.middleware');
const { connectRedis } = require('./config/redis');

// Import routes
const agentRoutes = require('./routes/agent.routes');
const { createSafeguardsRouter } = require('./routes/safeguards.routes');
const { createAuthRouter } = require('./routes/auth.routes');
const { createChatRouter } = require('./routes/chat.routes');
// Add other routes as you create them
// const userRoutes = require('./routes/user.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (method and path only: no IPs or request content)
app.use(requestLogMiddleware);

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
app.use('/api/auth', createAuthRouter());
app.use('/api/chat', createChatRouter());
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

  // Logs whether Redis is reachable; never throws. Until it is, the rate and
  // usage checks answer 503.
  connectRedis();
});

module.exports = app;
