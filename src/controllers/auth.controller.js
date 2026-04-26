import { UserModel } from '../models/user.js';
import { AuthMiddleware } from '../middleware/auth.js';

export class AuthController {
  async register(req, res) {
    try {
      const { username, password } = req.body;

      // Validate input
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      if (username.length < 3) {
        return res.status(400).json({
          success: false,
          error: 'Username must be at least 3 characters long'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }

      // Create user
      const result = await UserModel.createUser(username, password);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      // Generate JWT token
      const token = AuthMiddleware.generateToken(result.userId, username);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: result.userId,
          username: result.user.username,
          created_at: result.user.created_at
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async login(req, res) {
    try {
      const { username, password } = req.body;

      // Validate input
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      // Authenticate user
      const result = await UserModel.authenticateUser(username, password);
      
      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: result.error
        });
      }

      // Generate JWT token
      const token = AuthMiddleware.generateToken(result.user._id, username);

      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: result.user._id,
          username: result.user.username,
          profile: result.user.profile,
          memory_stats: result.user.memory_stats
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async getProfile(req, res) {
    try {
      // User is already attached to req by auth middleware
      const user = req.user;

      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          profile: user.profile,
          memory_stats: user.memory_stats,
          created_at: user.created_at
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async updateProfile(req, res) {
    try {
      const userId = req.userId;
      const { preferences, favorite_locations } = req.body;

      const profileUpdates = {};
      if (preferences) profileUpdates.preferences = preferences;
      if (favorite_locations) profileUpdates.favorite_locations = favorite_locations;

      const result = await UserModel.updateUserProfile(userId, profileUpdates);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async getUserStats(req, res) {
    try {
      const result = await UserModel.getUserStats();
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        stats: result.stats
      });
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async validateToken(req, res) {
    try {
      // If we reach here, token is valid (middleware already validated it)
      res.json({
        success: true,
        valid: true,
        user: {
          id: req.user._id,
          username: req.user.username
        }
      });
    } catch (error) {
      console.error('Validate token error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  async logout(req, res) {
    try {
      // For JWT, logout is handled client-side by removing the token
      // But we can track logout activity here if needed
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}
