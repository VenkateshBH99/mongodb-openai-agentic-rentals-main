import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI environment variable is required. Please check your .env.local file.');
}

class Database {
  constructor() {
    this.client = new MongoClient(uri);
    this.db = null;
    this.rentalsCollection = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      await this.client.connect();
      this.db = this.client.db('rental_app');
      this.rentalsCollection = this.db.collection('rentals');
      this.isConnected = true;
      console.log('✅ Connected to MongoDB Atlas');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('🔌 Database connection closed');
    }
  }

  async ping() {
    return await this.db.admin().ping();
  }

  getRentalsCollection() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return this.rentalsCollection;
  }

  getDatabase() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return this.db;
  }

  // Static methods for DatabaseManager compatibility
  static getDatabase() {
    return database.getDatabase();
  }

  static getRentalsCollection() {
    return database.getRentalsCollection();
  }
}

export const database = new Database();
export const DatabaseManager = Database;