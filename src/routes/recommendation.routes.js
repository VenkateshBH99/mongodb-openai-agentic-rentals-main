import { Elysia } from 'elysia';
import { recommendationService } from '../services/recommendation.service.js';
import { RentalModel, FRONTEND_PROJECTION } from '../models/rental.js';
import { DatabaseManager } from '../config/database.js';

export const recommendationRoutes = new Elysia({ prefix: '/recommendations' })

  // GET /recommendations/:userId — get ALS-based recommendations for a user
  .get('/:userId', async ({ params }) => {
    try {
      const { userId } = params;
      const { source, rentalIds } = recommendationService.getForUser(userId);

      if (!rentalIds || rentalIds.length === 0) {
        return { success: true, source, data: [], total: 0 };
      }

      // Fetch full rental data for the recommended IDs
      const collection = DatabaseManager.getRentalsCollection();
      const rentals = await collection
        .find({ _id: { $in: rentalIds } }, { projection: FRONTEND_PROJECTION })
        .toArray();

      // Preserve recommendation order
      const rentalMap = new Map(rentals.map(r => [r._id, r]));
      const ordered = rentalIds
        .map(id => rentalMap.get(id))
        .filter(Boolean);

      return {
        success: true,
        source,
        model: 'ALS (Alternating Least Squares)',
        data: ordered,
        total: ordered.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, {
    detail: {
      summary: 'Get rental recommendations for a user',
      description: 'Returns top-5 ALS collaborative filtering recommendations for a given user ID',
      tags: ['Recommendations']
    }
  })

  // GET /recommendations — stats about the recommendation model
  .get('/', () => {
    return {
      success: true,
      model: 'ALS (Alternating Least Squares)',
      description: 'Collaborative filtering recommendations — no AI/LLM involved',
      total_users: recommendationService.totalUsers,
      recommendations_per_user: 5
    };
  }, {
    detail: {
      summary: 'Recommendation model info',
      description: 'Returns information about the ALS recommendation model',
      tags: ['Recommendations']
    }
  });
