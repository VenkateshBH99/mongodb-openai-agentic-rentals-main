import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export class AuthMiddleware {
  static generateToken(userId, username) {
    return jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  static verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  static async authenticateToken(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Access token required'
        });
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or expired token'
        });
      }

      // Get user details
      const userResult = await UserModel.getUserById(decoded.userId);
      if (!userResult.success) {
        return res.status(403).json({
          success: false,
          error: 'User not found'
        });
      }

      // Add user info to request
      req.user = userResult.user;
      req.userId = decoded.userId;
      
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication error'
      });
    }
  }

  static async optionalAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (token) {
        const decoded = AuthMiddleware.verifyToken(token);
        if (decoded) {
          const userResult = await UserModel.getUserById(decoded.userId);
          if (userResult.success) {
            req.user = userResult.user;
            req.userId = decoded.userId;
          }
        }
      }
      
      next();
    } catch (error) {
      console.error('Optional auth middleware error:', error);
      next(); // Continue without auth
    }
  }

  static requireAuth(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    next();
  }
}
