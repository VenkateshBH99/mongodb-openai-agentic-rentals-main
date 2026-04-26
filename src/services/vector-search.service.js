import { DatabaseManager } from '../config/database.js';
import { OpenAI } from 'openai';
import { ObjectId } from 'mongodb';

class VectorSearchService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  async getPropertyById(propertyId) {
    try {
      const db = DatabaseManager.getDatabase();
      const collection = db.collection('rentals');
      
      const property = await collection.findOne(
        { _id: propertyId},
        {
          projection: {
            name: 1,
            description: 1,
            property_type: 1,
            room_type: 1,
            price: 1,
            bedrooms: 1,
            bathrooms: 1,
            accommodates: 1,
            address: 1,
            amenities: 1,
            host: 1,
            review_scores: 1,
            number_of_reviews: 1,
            availability: 1,
            images: 1
          }
        }
      );

      return property;
    } catch (error) {
      console.error('Error getting property by ID:', error);
      throw error;
    }
  }

  async vectorSearch(queryText, filters = {}, limit = 10) {
    try {
      const queryEmbedding = await this.generateEmbedding(queryText);
      
      const pipeline = [
        {
          $vectorSearch: {
            index: "rental_vector_search",
            path: "text_embeddings",
            queryVector: queryEmbedding,
            numCandidates: 100,
            limit: limit,
            filter: this.buildVectorSearchFilter(filters)
          }
        },
        {
          $project: {
            name: 1,
            description: 1,
            property_type: 1,
            room_type: 1,
            price: 1,
            bedrooms: 1,
            bathrooms: 1,
            accommodates: 1,
            "address.neighbourhood": 1,
            "address.market": 1,
            "address.country": 1,
            "images.picture_url": 1,
            "host.host_is_superhost": 1,
            "review_scores.review_scores_rating": 1,
            score: { $meta: "vectorSearchScore" }
          }
        }
      ];

      const db = DatabaseManager.getDatabase();
      const collection = db.collection('rentals');
      const results = await collection.aggregate(pipeline).toArray();
      
      return results;
    } catch (error) {
      console.error('Error performing vector search:', error);
      throw error;
    }
  }

  buildVectorSearchFilter(filters) {
    const vectorFilter = {};
    
    if (!filters) {
      return {};
    }
    
    if (filters.property_type) {
      vectorFilter.property_type = { $eq: filters.property_type };
    }
    
    if (filters.room_type) {
      vectorFilter.room_type = { $eq: filters.room_type };
    }
    
    if (filters.min_price || filters.max_price) {
      vectorFilter.price = {};
      if (filters.min_price) vectorFilter.price.$gte = parseInt(filters.min_price);
      if (filters.max_price) vectorFilter.price.$lte = parseInt(filters.max_price);
    }
    
    if (filters.min_bedrooms) {
      vectorFilter.bedrooms = { $gte: parseInt(filters.min_bedrooms) };
    }
    
    if (filters.min_accommodates) {
      vectorFilter.accommodates = { $gte: parseInt(filters.min_accommodates) };
    }
    
    if (filters.superhost_only === 'true') {
      vectorFilter["host.host_is_superhost"] = { $eq: true };
    }
    
    if (filters.country) {
      vectorFilter["address.country"] = { $eq: filters.country };
    }
    
    // Add location/market filtering - this is key for location-based searches
    if (filters.location) {
      vectorFilter["address.market"] = { $eq: filters.location };
    }
    
    return Object.keys(vectorFilter).length > 0 ? vectorFilter : {};
  }

  async hybridSearch(queryText, filters = {}, limit = 10) {
    try {
      // Perform both vector search and traditional search
      const [vectorResults, traditionalResults] = await Promise.all([
        this.vectorSearch(queryText, filters, Math.ceil(limit * 0.7)),
        this.traditionalSearch(queryText, filters, Math.ceil(limit * 0.3))
      ]);

      // Combine and deduplicate results
      const combinedResults = [...vectorResults];
      const vectorIds = new Set(vectorResults.map(r => r._id.toString()));
      
      for (const result of traditionalResults) {
        if (!vectorIds.has(result._id.toString())) {
          combinedResults.push({ ...result, score: 0.5 });
        }
      }

      // Sort by score and limit
      return combinedResults
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, limit);
    } catch (error) {
      console.error('Error performing hybrid search:', error);
      throw error;
    }
  }

  async traditionalSearch(queryText, filters = {}, limit = 10) {
    try {
      const db = DatabaseManager.getDatabase();
      const collection = db.collection('rentals');
      
      const searchQuery = {
        $or: [
          { name: { $regex: queryText, $options: 'i' } },
          { description: { $regex: queryText, $options: 'i' } },
          { "address.neighbourhood": { $regex: queryText, $options: 'i' } },
          { "address.market": { $regex: queryText, $options: 'i' } },
          { property_type: { $regex: queryText, $options: 'i' } }
        ]
      };

      // Add filters
      if (filters && filters.property_type) {
        searchQuery.property_type = filters.property_type;
      }
      
      if (filters && (filters.min_price || filters.max_price)) {
        searchQuery.price = {};
        if (filters.min_price) searchQuery.price.$gte = parseInt(filters.min_price);
        if (filters.max_price) searchQuery.price.$lte = parseInt(filters.max_price);
      }

      const results = await collection
        .find(searchQuery)
        .project({
          name: 1,
          description: 1,
          property_type: 1,
          room_type: 1,
          price: 1,
          bedrooms: 1,
          bathrooms: 1,
          accommodates: 1,
          "address.neighbourhood": 1,
          "address.market": 1,
          "address.country": 1,
          "images.picture_url": 1,
          "host.host_is_superhost": 1,
          "review_scores.review_scores_rating": 1
        })
        .limit(limit)
        .toArray();

      return results;
    } catch (error) {
      console.error('Error performing traditional search:', error);
      throw error;
    }
  }

  async getPropertyById(propertyId) {
    try {
      const db = DatabaseManager.getDatabase();
      const collection = db.collection('rentals');
      
      // Try to find by different ID formats
      let query;
      if (propertyId.match(/^[0-9a-fA-F]{24}$/)) {
        // MongoDB ObjectId format
        const { ObjectId } = await import('mongodb');
        query = { _id: ObjectId.createFromHexString(propertyId) };
      } else {
        // Numeric ID or string ID
        query = { 
          $or: [
            { _id: propertyId },
            { id: propertyId },
            { listing_id: propertyId }
          ]
        };
      }

      const property = await collection.findOne(query);
      return property;
    } catch (error) {
      console.error('Error getting property by ID:', error);
      throw error;
    }
  }
}

export const vectorSearchService = new VectorSearchService();