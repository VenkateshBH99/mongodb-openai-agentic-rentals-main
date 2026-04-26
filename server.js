import { Elysia } from 'elysia';
import { MongoClient, ObjectId } from 'mongodb';

// MongoDB connection
const uri = 'mongodb+srv://rental-app-user:RentalApp2024%21@ilcluster.wagfu.mongodb.net/rental_app';
const client = new MongoClient(uri);
let db, rentalsCollection;

// Initialize database connection
async function initDatabase() {
  try {
    await client.connect();
    db = client.db('rental_app');
    rentalsCollection = db.collection('rentals');
    console.log('✅ Connected to MongoDB Atlas');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

// Helper function to validate ObjectId
const isValidObjectId = (id) => ObjectId.isValid(id);

// Helper function to build search query
const buildSearchQuery = (params) => {
  const query = {};
  
  if (params.text) {
    query.$text = { $search: params.text };
  }
  
  if (params.location) {
    query.$or = [
      { 'address.street': { $regex: params.location, $options: 'i' } },
      { 'address.neighbourhood': { $regex: params.location, $options: 'i' } },
      { 'address.market': { $regex: params.location, $options: 'i' } },
      { 'address.country': { $regex: params.location, $options: 'i' } }
    ];
  }
  
  if (params.property_type) query.property_type = params.property_type;
  if (params.room_type) query.room_type = params.room_type;
  if (params.country) query['address.country'] = params.country;
  
  if (params.min_price || params.max_price) {
    query.price = {};
    if (params.min_price) query.price.$gte = parseInt(params.min_price);
    if (params.max_price) query.price.$lte = parseInt(params.max_price);
  }
  
  if (params.bedrooms) query.bedrooms = parseInt(params.bedrooms);
  if (params.min_bedrooms) query.bedrooms = { $gte: parseInt(params.min_bedrooms) };
  if (params.bathrooms) query.bathrooms = { $gte: parseInt(params.bathrooms) };
  if (params.accommodates) query.accommodates = { $gte: parseInt(params.accommodates) };
  
  if (params.superhost_only === 'true') {
    query['host.host_is_superhost'] = true;
  }
  
  if (params.instant_bookable === 'true') {
    query.instant_bookable = true;
  }
  
  return query;
};

// Initialize database and start server
await initDatabase();

const app = new Elysia()
  .get('/', () => ({
    message: '🏠 Rental App API powered by Elysia.js & MongoDB Atlas',
    version: '1.0.0',
    endpoints: {
      'GET /': 'API info',
      'GET /rentals': 'Get all rentals with filters',
      'GET /rentals/:id': 'Get rental by ID',
      'POST /rentals': 'Create new rental',
      'PUT /rentals/:id': 'Update rental',
      'DELETE /rentals/:id': 'Delete rental',
      'GET /search': 'Advanced search rentals',
      'GET /stats': 'Get rental statistics'
    }
  }))
  
  // GET /rentals - Get all rentals with optional filters and pagination
  .get('/rentals', async ({ query }) => {
    try {
      const {
        limit = 20,
        skip = 0,
        page = 1,
        sortBy = 'price',
        sortOrder = 1,
        ...filters
      } = query;
      
      const actualSkip = page > 1 ? (parseInt(page) - 1) * parseInt(limit) : parseInt(skip);
      const searchQuery = buildSearchQuery(filters);
      const sort = { [sortBy]: parseInt(sortOrder) };
      
      const rentals = await rentalsCollection
        .find(searchQuery)
        .sort(sort)
        .limit(parseInt(limit))
        .skip(actualSkip)
        .toArray();
      
      const total = await rentalsCollection.countDocuments(searchQuery);
      
      return {
        success: true,
        data: rentals,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: actualSkip,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          hasMore: actualSkip + parseInt(limit) < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  
  // GET /rentals/:id - Get rental by ID
  .get('/rentals/:id', async ({ params }) => {
    try {
      const { id } = params;
      
      if (!isValidObjectId(id)) {
        return {
          success: false,
          error: 'Invalid rental ID format'
        };
      }
      
      const rental = await rentalsCollection.findOne({ _id: new ObjectId(id) });
      
      if (!rental) {
        return {
          success: false,
          error: 'Rental not found'
        };
      }
      
      return {
        success: true,
        data: rental
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  
  // POST /rentals - Create new rental
  .post('/rentals', async ({ body }) => {
    try {
      const rentalData = {
        ...body,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const result = await rentalsCollection.insertOne(rentalData);
      
      return {
        success: true,
        data: {
          id: result.insertedId,
          message: 'Rental created successfully'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  
  // PUT /rentals/:id - Update rental
  .put('/rentals/:id', async ({ params, body }) => {
    try {
      const { id } = params;
      
      if (!isValidObjectId(id)) {
        return {
          success: false,
          error: 'Invalid rental ID format'
        };
      }
      
      const updateData = {
        ...body,
        updated_at: new Date()
      };
      
      const result = await rentalsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return {
          success: false,
          error: 'Rental not found'
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
        error: error.message
      };
    }
  })
  
  // DELETE /rentals/:id - Delete rental
  .delete('/rentals/:id', async ({ params }) => {
    try {
      const { id } = params;
      
      if (!isValidObjectId(id)) {
        return {
          success: false,
          error: 'Invalid rental ID format'
        };
      }
      
      const result = await rentalsCollection.deleteOne({ _id: new ObjectId(id) });
      
      if (result.deletedCount === 0) {
        return {
          success: false,
          error: 'Rental not found'
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
        error: error.message
      };
    }
  })
  
  // GET /search - Advanced search
  .get('/search', async ({ query }) => {
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
      const searchQuery = buildSearchQuery(searchParams);
      const sort = { [sortBy]: parseInt(sortOrder) };
      
      const rentals = await rentalsCollection
        .find(searchQuery)
        .sort(sort)
        .limit(parseInt(limit))
        .skip(actualSkip)
        .toArray();
      
      const total = await rentalsCollection.countDocuments(searchQuery);
      
      return {
        success: true,
        data: rentals,
        searchQuery,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: actualSkip,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          hasMore: actualSkip + parseInt(limit) < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  
  // GET /stats - Get rental statistics
  .get('/stats', async () => {
    try {
      // Overall stats
      const overallStats = await rentalsCollection.aggregate([
        {
          $group: {
            _id: null,
            total_rentals: { $sum: 1 },
            avg_price: { $avg: '$price' },
            min_price: { $min: '$price' },
            max_price: { $max: '$price' },
            avg_bedrooms: { $avg: '$bedrooms' },
            avg_bathrooms: { $avg: '$bathrooms' },
            avg_accommodates: { $avg: '$accommodates' }
          }
        },
        {
          $project: {
            _id: 0,
            total_rentals: 1,
            avg_price: { $round: ['$avg_price', 2] },
            min_price: 1,
            max_price: 1,
            avg_bedrooms: { $round: ['$avg_bedrooms', 1] },
            avg_bathrooms: { $round: ['$avg_bathrooms', 1] },
            avg_accommodates: { $round: ['$avg_accommodates', 1] }
          }
        }
      ]).toArray();
      
      // Property type stats
      const propertyTypeStats = await rentalsCollection.aggregate([
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
      ]).toArray();
      
      // Location stats
      const locationStats = await rentalsCollection.aggregate([
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
      ]).toArray();
      
      return {
        success: true,
        data: {
          overall: overallStats[0] || {},
          by_property_type: propertyTypeStats,
          by_country: locationStats
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  })
  
  // Health check
  .get('/health', async () => {
    try {
      await db.admin().ping();
      const count = await rentalsCollection.countDocuments();
      
      return {
        status: 'healthy',
        database: 'connected',
        total_rentals: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  })
  
  .listen(3001);

console.log(`🚀 Rental API is running at http://localhost:3001`);