// ============================================================================
// FILE: backend/middleware/auth.middleware.js
// Authentication Middleware
// ============================================================================

import jwt from 'jsonwebtoken';
import { loadConfig } from '../config/index.js';
import logger from '../utils/logger.js';

const config = loadConfig();

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
    logger.error('Auth middleware error', { error: error.message });
    
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

export { authMiddleware };
