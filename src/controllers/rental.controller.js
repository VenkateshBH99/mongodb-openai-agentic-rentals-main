import { RentalModel } from '../models/rental.js';

export class RentalController {
  constructor() {
    this.rentalModel = new RentalModel();
  }

  // GET /rentals - List rentals with filters
  async getAllRentals({ query }) {
    try {
      const {
        limit = 20,
        skip = 0,
        page = 1,
        sortBy = 'price',
        sortOrder = 1,
        ...filters
      } = query;

      // Calculate skip based on page if provided
      const actualSkip = page > 1 ? (parseInt(page) - 1) * parseInt(limit) : parseInt(skip);
      
      // Build sort object - handle both string and number values
      const sortOrderNum = typeof sortOrder === 'string' ? parseInt(sortOrder) : sortOrder;
      const sort = { [sortBy]: sortOrderNum };
      
      // Build search query from filters
      const searchQuery = RentalModel.buildSearchQuery(filters);
      
      const result = await this.rentalModel.findMany(searchQuery, {
        limit: parseInt(limit),
        skip: actualSkip,
        sort
      });

      return {
        success: true,
        ...result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // GET /rentals/:id - Get single rental
  async getRentalById({ params }) {
    try {
      const { id } = params;
      const result = await this.rentalModel.findById(id, true); // detailed = true
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          statusCode: result.errorCode === 'NOT_FOUND' ? 404 : 400
        };
      }
      
      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }

  // POST /rentals - Create new rental
  async createRental({ body }) {
    try {
      const result = await this.rentalModel.create(body);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          statusCode: result.errorCode === 'VALIDATION' ? 400 : 500
        };
      }

      return {
        success: true,
        data: {
          id: result.insertedId,
          message: 'Rental created successfully'
        },
        statusCode: 201
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }

  // PUT /rentals/:id - Update rental
  async updateRental({ params, body }) {
    try {
      const { id } = params;
      const result = await this.rentalModel.updateById(id, body);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          statusCode: result.errorCode === 'NOT_FOUND' ? 404 : 400
        };
      }
      
      return {
        success: true,
        data: {
          message: 'Rental updated successfully',
          modifiedCount: result.modifiedCount
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }

  // DELETE /rentals/:id - Delete rental
  async deleteRental({ params }) {
    try {
      const { id } = params;
      const result = await this.rentalModel.deleteById(id);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          statusCode: result.errorCode === 'NOT_FOUND' ? 404 : 400
        };
      }
      
      return {
        success: true,
        data: {
          message: 'Rental deleted successfully'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }

  // GET /search - Advanced search
  async searchRentals({ query }) {
    try {
      const {
        limit = 20,
        skip = 0,
        page = 1,
        sortBy = 'price',
        sortOrder = 1,
        ...searchParams
      } = query;

      const actualSkip = page > 1 ? (parseInt(page) - 1) * parseInt(limit) : parseInt(skip);
      const sortOrderNum = typeof sortOrder === 'string' ? parseInt(sortOrder) : sortOrder;
      const sort = { [sortBy]: sortOrderNum };
      
      const result = await this.rentalModel.search(searchParams, {
        limit: parseInt(limit),
        skip: actualSkip,
        sort
      });

      return {
        success: true,
        searchParams,
        ...result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // GET /stats - Get statistics
  async getStats() {
    try {
      const stats = await this.rentalModel.getStats();
      
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}