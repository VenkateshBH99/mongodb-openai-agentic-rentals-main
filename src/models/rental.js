import { ObjectId } from 'mongodb';
import { DatabaseManager } from '../config/database.js';

// Frontend-safe projection - excludes heavy/unnecessary fields
export const FRONTEND_PROJECTION = {
  // Include essential fields
  _id: 1,
  name: 1,
  summary: 1,
  property_type: 1,
  room_type: 1,
  accommodates: 1,
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  price: 1,
  minimum_nights: 1,
  maximum_nights: 1,
  instant_bookable: 1,
  cancellation_policy: 1,
  number_of_reviews: 1,
  
  // Host info (minimal)
  'host.host_id': 1,
  'host.host_name': 1,
  'host.host_is_superhost': 1,
  'host.host_picture_url': 1,
  'host.host_response_rate': 1,
  'host.host_response_time': 1,
  
  // Address (essential location info)
  'address.street': 1,
  'address.neighbourhood': 1,
  'address.market': 1,
  'address.country': 1,
  'address.country_code': 1,
  
  // Images
  'images.picture_url': 1,
  'images.thumbnail_url': 1,
  
  // Essential amenities (first 10 most important)
  amenities: { $slice: 10 },
  
  // Reviews summary
  review_scores: 1,
  
  // Exclude heavy fields that aren't needed in FE:
  // - Full description (use summary instead)
  // - space, neighborhood_overview, notes, transit, access, interaction, house_rules
  // - Full host details (host_about, host_verifications, etc.)
  // - All review objects (too heavy)
  // - calendar_* fields
  // - availability_* detailed fields
};

// Detailed projection for single rental view
export const DETAILED_PROJECTION = {
  ...FRONTEND_PROJECTION,
  description: 1,
  space: 1,
  neighborhood_overview: 1,
  transit: 1,
  amenities: 1, // Full amenities list for details page
  'host.host_about': 1,
  'host.host_location': 1,
  'host.host_neighbourhood': 1,
  first_review: 1,
  last_review: 1,
};

// Search-optimized projection
export const SEARCH_PROJECTION = {
  _id: 1,
  name: 1,
  summary: 1,
  property_type: 1,
  room_type: 1,
  accommodates: 1,
  bedrooms: 1,
  bathrooms: 1,
  price: 1,
  instant_bookable: 1,
  number_of_reviews: 1,
  'host.host_is_superhost': 1,
  'address.neighbourhood': 1,
  'address.market': 1,
  'address.country': 1,
  'images.thumbnail_url': 1,
  'review_scores.review_scores_rating': 1,
};

export class RentalModel {
  static getCollection() {
    return DatabaseManager.getRentalsCollection();
  }

  // Validate ID - accept both ObjectId and other ID formats
  static isValidId(id) {
    return id && typeof id === 'string' && id.length > 0;
  }

  // Build a query for finding by ID (ObjectId or numeric)
  static _buildIdQuery(id) {
    if (ObjectId.isValid(id)) {
      return { _id: new ObjectId(id) };
    }
    const numericId = !isNaN(id) ? parseInt(id) : id;
    return { _id: numericId };
  }

  // Validate required fields for creating a rental
  static validateRentalData(data) {
    const errors = [];
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('name is required');
    }
    if (data.price !== undefined && (typeof data.price !== 'number' || data.price < 0)) {
      errors.push('price must be a non-negative number');
    }
    if (data.bedrooms !== undefined && (typeof data.bedrooms !== 'number' || data.bedrooms < 0)) {
      errors.push('bedrooms must be a non-negative number');
    }
    if (data.property_type && typeof data.property_type !== 'string') {
      errors.push('property_type must be a string');
    }
    return errors;
  }

  // Ensure required indexes exist (tolerates pre-existing indexes)
  static async ensureIndexes() {
    const collection = this.getCollection();
    const tryIndex = async (spec, opts) => {
      try { await collection.createIndex(spec, opts); }
      catch (e) { if (e.code !== 85) throw e; }
    };
    await tryIndex({ name: 'text', summary: 'text', description: 'text' }, { name: 'text_search_idx' });
    await tryIndex({ price: 1 }, { name: 'price_asc' });
    await tryIndex({ bedrooms: 1 }, { name: 'bedrooms_asc' });
    await tryIndex({ 'address.market': 1 }, { name: 'market' });
    await tryIndex({ property_type: 1 }, { name: 'property_type' });
    console.log('✅ Rental indexes ensured');
  }

  // Stats cache
  static _statsCache = null;
  static _statsCacheExpiry = 0;
  static STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Build search query with proper filtering
  static buildSearchQuery(params) {
    const query = {};
    
    // If specific IDs are provided, use them (for AI search results)
    if (params.ids) {
      const ids = Array.isArray(params.ids) ? params.ids : params.ids.split(',');
      // Handle both ObjectId and numeric IDs
      const objectIds = [];
      const numericIds = [];
      
      ids.forEach(id => {
        const trimmedId = id.toString().trim();
        if (ObjectId.isValid(trimmedId)) {
          objectIds.push(new ObjectId(trimmedId));
        } else {
          // Try as numeric ID
          const numericId = !isNaN(trimmedId) ? parseInt(trimmedId) : trimmedId;
          numericIds.push(numericId);
        }
      });
      
      if (objectIds.length > 0 && numericIds.length > 0) {
        query.$or = [
          { _id: { $in: objectIds } },
          { _id: { $in: numericIds } }
        ];
      } else if (objectIds.length > 0) {
        query._id = { $in: objectIds };
      } else if (numericIds.length > 0) {
        query._id = { $in: numericIds };
      }
      
      console.log('Built query for specific IDs:', query);
      return query; // Return early, ignore other filters when using specific IDs
    }
    
    // Text search
    if (params.text) {
      query.$text = { $search: params.text };
    }
    
    // Location search - optimized for common searches
    if (params.location) {
      query.$or = [
        { 'address.neighbourhood': { $regex: params.location, $options: 'i' } },
        { 'address.market': { $regex: params.location, $options: 'i' } },
        { 'address.country': { $regex: params.location, $options: 'i' } }
      ];
    }
    
    // Exact matches
    if (params.property_type) query.property_type = params.property_type;
    if (params.room_type) query.room_type = params.room_type;
    if (params.country) query['address.country'] = params.country;
    
    // Numeric filters
    if (params.min_price || params.max_price) {
      query.price = {};
      if (params.min_price) query.price.$gte = parseInt(params.min_price);
      if (params.max_price) query.price.$lte = parseInt(params.max_price);
    }
    
    if (params.min_bedrooms) query.bedrooms = { $gte: parseInt(params.min_bedrooms) };
    if (params.min_bathrooms) query.bathrooms = { $gte: parseInt(params.min_bathrooms) };
    if (params.min_accommodates) query.accommodates = { $gte: parseInt(params.min_accommodates) };
    
    // Boolean filters
    if (params.superhost_only === 'true') {
      query['host.host_is_superhost'] = true;
    }
    
    if (params.instant_bookable === 'true') {
      query.instant_bookable = true;
    }
    
    // Review score filter
    if (params.min_rating) {
      query['review_scores.review_scores_rating'] = { $gte: parseInt(params.min_rating) };
    }
    
    return query;
  }

  // Get rentals with pagination and projection
  async findMany(query = {}, options = {}) {
    const {
      limit = 20,
      skip = 0,
      sort = { price: 1 },
      projection = FRONTEND_PROJECTION
    } = options;

    const collection = RentalModel.getCollection();
    const rentals = await collection
      .find(query, { projection })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();

    const total = await collection.countDocuments(query);

    return {
      data: rentals,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        page: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(skip) + parseInt(limit) < total
      }
    };
  }

  // Get single rental by ID
  async findById(id, detailed = false) {
    if (!RentalModel.isValidId(id)) {
      return { success: false, errorCode: 'INVALID_ID', error: 'Invalid rental ID format' };
    }

    const projection = detailed ? DETAILED_PROJECTION : FRONTEND_PROJECTION;
    const query = RentalModel._buildIdQuery(id);
    const collection = RentalModel.getCollection();
    const rental = await collection.findOne(query, { projection });
    
    if (!rental) {
      return { success: false, errorCode: 'NOT_FOUND', error: 'Rental not found' };
    }
    return { success: true, data: rental };
  }

  // Create new rental
  async create(rentalData) {
    const validationErrors = RentalModel.validateRentalData(rentalData);
    if (validationErrors.length > 0) {
      return { success: false, errorCode: 'VALIDATION', error: validationErrors.join(', ') };
    }

    const rental = {
      ...rentalData,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const collection = RentalModel.getCollection();
    const result = await collection.insertOne(rental);
    return { success: true, insertedId: result.insertedId };
  }

  // Update rental
  async updateById(id, updateData) {
    if (!RentalModel.isValidId(id)) {
      return { success: false, errorCode: 'INVALID_ID', error: 'Invalid rental ID format' };
    }

    const update = {
      ...updateData,
      updated_at: new Date()
    };
    
    const query = RentalModel._buildIdQuery(id);
    const collection = RentalModel.getCollection();
    const result = await collection.updateOne(query, { $set: update });
    
    if (result.matchedCount === 0) {
      return { success: false, errorCode: 'NOT_FOUND', error: 'Rental not found' };
    }
    return { success: true, modifiedCount: result.modifiedCount };
  }

  // Delete rental
  async deleteById(id) {
    if (!RentalModel.isValidId(id)) {
      return { success: false, errorCode: 'INVALID_ID', error: 'Invalid rental ID format' };
    }
    
    const query = RentalModel._buildIdQuery(id);
    const collection = RentalModel.getCollection();
    const result = await collection.deleteOne(query);
    
    if (result.deletedCount === 0) {
      return { success: false, errorCode: 'NOT_FOUND', error: 'Rental not found' };
    }
    return { success: true, deletedCount: result.deletedCount };
  }

  // Search with optimized projection
  async search(searchParams, options = {}) {
    const query = RentalModel.buildSearchQuery(searchParams);
    const searchOptions = {
      ...options,
      projection: SEARCH_PROJECTION
    };
    
    return await this.findMany(query, searchOptions);
  }

  // Get statistics (cached for 5 minutes)
  async getStats() {
    const now = Date.now();
    if (RentalModel._statsCache && now < RentalModel._statsCacheExpiry) {
      return RentalModel._statsCache;
    }

    const collection = RentalModel.getCollection();
    const pipeline = [
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                total_rentals: { $sum: 1 },
                avg_price: { $avg: '$price' },
                min_price: { $min: '$price' },
                max_price: { $max: '$price' },
                avg_rating: { $avg: '$review_scores.review_scores_rating' }
              }
            },
            {
              $project: {
                _id: 0,
                total_rentals: 1,
                avg_price: { $round: ['$avg_price', 2] },
                min_price: 1,
                max_price: 1,
                avg_rating: { $round: ['$avg_rating', 1] }
              }
            }
          ],
          byPropertyType: [
            {
              $group: {
                _id: '$property_type',
                count: { $sum: 1 },
                avg_price: { $avg: '$price' }
              }
            },
            {
              $project: {
                property_type: '$_id',
                count: 1,
                avg_price: { $round: ['$avg_price', 2] },
                _id: 0
              }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ],
          byCountry: [
            {
              $group: {
                _id: '$address.country',
                count: { $sum: 1 },
                avg_price: { $avg: '$price' }
              }
            },
            {
              $project: {
                country: '$_id',
                count: 1,
                avg_price: { $round: ['$avg_price', 2] },
                _id: 0
              }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ]
        }
      }
    ];

    const result = await collection.aggregate(pipeline).toArray();
    const stats = result[0];

    // Cache the result
    RentalModel._statsCache = stats;
    RentalModel._statsCacheExpiry = Date.now() + RentalModel.STATS_CACHE_TTL;

    return stats;
  }
}