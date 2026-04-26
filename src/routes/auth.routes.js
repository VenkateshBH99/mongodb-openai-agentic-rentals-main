import { AuthController } from '../controllers/auth.controller.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { UserModel } from '../models/user.js';
import { RentalModel } from '../models/rental.js';

const authController = new AuthController();

export const authRoutes = (app) => {
  // Register endpoint
  app.post('/auth/register', async ({ body, set }) => {
    try {
      const { username, password } = body;

      // Validate input
      if (!username || !password) {
        set.status = 400;
        return {
          success: false,
          error: 'Username and password are required'
        };
      }

      if (username.length < 3) {
        set.status = 400;
        return {
          success: false,
          error: 'Username must be at least 3 characters long'
        };
      }

      if (password.length < 6) {
        set.status = 400;
        return {
          success: false,
          error: 'Password must be at least 6 characters long'
        };
      }

      // Create user
      const result = await UserModel.createUser(username, password);
      
      if (!result.success) {
        set.status = 400;
        return {
          success: false,
          error: result.error
        };
      }

      // Generate JWT token
      const token = AuthMiddleware.generateToken(result.userId, username);

      set.status = 201;
      return {
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: result.userId,
          username: result.user.username,
          created_at: result.user.created_at
        }
      };
    } catch (error) {
      console.error('Registration error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Login endpoint
  app.post('/auth/login', async ({ body, set }) => {
    try {
      const { username, password } = body;

      // Validate input
      if (!username || !password) {
        set.status = 400;
        return {
          success: false,
          error: 'Username and password are required'
        };
      }

      // Authenticate user
      const result = await UserModel.authenticateUser(username, password);
      
      if (!result.success) {
        set.status = 401;
        return {
          success: false,
          error: result.error
        };
      }

      // Generate JWT token
      const token = AuthMiddleware.generateToken(result.user._id, username);

      return {
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: result.user._id,
          username: result.user.username,
          profile: result.user.profile,
          memory_stats: result.user.memory_stats
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Logout endpoint
  app.post('/auth/logout', async ({ set }) => {
    return {
      success: true,
      message: 'Logged out successfully'
    };
  });

  // Get user stats endpoint
  app.get('/auth/stats', async ({ set }) => {
    try {
      const result = await UserModel.getUserStats();
      
      if (!result.success) {
        set.status = 500;
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        stats: result.stats
      };
    } catch (error) {
      console.error('Get user stats error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Protected routes with auth middleware
  app.get('/auth/profile', async ({ headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const userResult = await UserModel.getUserById(decoded.userId);
      if (!userResult.success) {
        set.status = 403;
        return {
          success: false,
          error: 'User not found'
        };
      }

      return {
        success: true,
        user: {
          id: userResult.user._id,
          username: userResult.user.username,
          profile: userResult.user.profile,
          memory_stats: userResult.user.memory_stats,
          created_at: userResult.user.created_at
        }
      };
    } catch (error) {
      console.error('Get profile error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Validate token endpoint
  app.get('/auth/validate', async ({ headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const userResult = await UserModel.getUserById(decoded.userId);
      if (!userResult.success) {
        set.status = 403;
        return {
          success: false,
          error: 'User not found'
        };
      }

      return {
        success: true,
        valid: true,
        user: {
          id: userResult.user._id,
          username: userResult.user.username
        }
      };
    } catch (error) {
      console.error('Validate token error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Update profile endpoint
  app.put('/auth/profile', async ({ body, headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const { preferences, favorite_locations } = body;
      const profileUpdates = {};
      if (preferences) profileUpdates.preferences = preferences;
      if (favorite_locations) profileUpdates.favorite_locations = favorite_locations;

      const result = await UserModel.updateUserProfile(decoded.userId, profileUpdates);
      
      if (!result.success) {
        set.status = 400;
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        message: 'Profile updated successfully'
      };
    } catch (error) {
      console.error('Update profile error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  });

  // Save rental endpoint
  app.post('/auth/saved-rentals/:rentalId', async ({ params, headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const { rentalId } = params;

      // Fetch rental data to store basic info
      const rentalModel = new RentalModel();
      const rentalResult = await rentalModel.findById(rentalId);
      
      if (!rentalResult.success) {
        set.status = 404;
        return {
          success: false,
          error: 'Rental not found'
        };
      }

      const rental = rentalResult.data;

      // Store minimal rental data for quick access
      const rentalData = {
        name: rental.name,
        property_type: rental.property_type,
        price: rental.price,
        location: `${rental.address?.neighbourhood || rental.address?.market || ''}, ${rental.address?.country || ''}`.replace(/^, /, ''),
        image: rental.images?.thumbnail_url
      };

      const result = await UserModel.saveRental(decoded.userId, rentalId, rentalData);
      
      if (!result.success) {
        set.status = 400;
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        message: 'Rental saved successfully'
      };
    } catch (error) {
      console.error('Save rental error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }, {
    detail: {
      summary: 'Save Rental',
      description: 'Save a rental property to user\'s saved list',
      tags: ['Auth']
    }
  });

  // Unsave rental endpoint
  app.delete('/auth/saved-rentals/:rentalId', async ({ params, headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const { rentalId } = params;
      const result = await UserModel.unsaveRental(decoded.userId, rentalId);
      
      if (!result.success) {
        set.status = 400;
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        message: 'Rental removed from saved list'
      };
    } catch (error) {
      console.error('Unsave rental error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }, {
    detail: {
      summary: 'Unsave Rental',
      description: 'Remove a rental property from user\'s saved list',
      tags: ['Auth']
    }
  });

  // Get saved rentals endpoint
  app.get('/auth/saved-rentals', async ({ headers, query, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const result = await UserModel.getSavedRentals(decoded.userId);
      
      if (!result.success) {
        set.status = 500;
        return {
          success: false,
          error: result.error
        };
      }

      // Optionally fetch full rental details if requested
      const includeDetails = query.include_details === 'true';
      let savedRentals = result.savedRentals;

      if (includeDetails && savedRentals.length > 0) {
        const rentalModel = new RentalModel();
        const detailedRentals = await Promise.all(
          savedRentals.map(async (saved) => {
            try {
              const result = await rentalModel.findById(saved.rental_id);
              return {
                ...saved,
                full_rental_data: result.success ? result.data : null
              };
            } catch (error) {
              console.error(`Error fetching rental ${saved.rental_id}:`, error);
              return saved; // Return basic saved data if full fetch fails
            }
          })
        );
        savedRentals = detailedRentals;
      }

      return {
        success: true,
        saved_rentals: savedRentals,
        count: savedRentals.length
      };
    } catch (error) {
      console.error('Get saved rentals error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }, {
    detail: {
      summary: 'Get Saved Rentals',
      description: 'Get user\'s saved rental properties',
      tags: ['Auth']
    }
  });

  // Check if rental is saved endpoint
  app.get('/auth/saved-rentals/:rentalId/check', async ({ params, headers, set }) => {
    try {
      const authHeader = headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        set.status = 401;
        return {
          success: false,
          error: 'Access token required'
        };
      }

      const decoded = AuthMiddleware.verifyToken(token);
      if (!decoded) {
        set.status = 403;
        return {
          success: false,
          error: 'Invalid or expired token'
        };
      }

      const { rentalId } = params;
      const result = await UserModel.isRentalSaved(decoded.userId, rentalId);
      
      if (!result.success) {
        set.status = 500;
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        is_saved: result.isSaved
      };
    } catch (error) {
      console.error('Check rental saved error:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }, {
    detail: {
      summary: 'Check if Rental is Saved',
      description: 'Check if a rental property is in user\'s saved list',
      tags: ['Auth']
    }
  });
};
