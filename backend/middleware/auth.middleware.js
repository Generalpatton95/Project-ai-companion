// ============================================================================
// FILE: backend/middleware/auth.middleware.js
// Authentication Middleware
// ============================================================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');

function authMiddleware(req, res, next) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'No token provided' 
      });
    }
    
    const token = authHeader.substring(7);
    
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Attach user to request
    req.user = decoded;
    
    next();
    
  } catch (error) {
    logger.error('Auth middleware error', errorFields(error));
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired' 
      });
    }
    
    return res.status(401).json({ 
      error: 'Invalid token' 
    });
  }
}

module.exports = { authMiddleware };
