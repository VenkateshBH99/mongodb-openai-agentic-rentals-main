import { DatabaseManager } from '../config/database.js';
import { ObjectId } from 'mongodb';

export class ConversationModel {
  static getCollection() {
    const db = DatabaseManager.getDatabase();
    return db.collection('conversations');
  }

  static MAX_MESSAGES_PER_CONVERSATION = 100;

  // Ensure required indexes exist (tolerates pre-existing indexes, TTL auto-deletes old conversations)
  static async ensureIndexes() {
    const collection = this.getCollection();
    const tryIndex = async (spec, opts) => {
      try { await collection.createIndex(spec, opts); }
      catch (e) { if (e.code !== 85) throw e; }
    };
    await tryIndex({ sessionId: 1 }, { unique: true, name: 'sessionId_unique' });
    await tryIndex({ userId: 1 }, { name: 'userId' });
    await tryIndex(
      { 'metadata.lastActivity': 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_lastActivity' }
    );
    console.log('\u2705 Conversation indexes ensured (TTL: 30 days)');
  }

  static async createConversation(sessionId, userId = null) {
    try {
      const collection = this.getCollection();
      const conversation = {
        sessionId,
        userId, // null for anonymous users
        isAuthenticated: userId !== null,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          totalMessages: 0,
          lastActivity: new Date(),
          userType: userId ? 'authenticated' : 'anonymous'
        }
      };

      const result = await collection.insertOne(conversation);
      return { success: true, conversationId: result.insertedId };
    } catch (error) {
      console.error('Error creating conversation:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async addMessage(sessionId, role, content, metadata = {}, userId = null) {
    try {
      const collection = this.getCollection();
      const message = {
        id: new ObjectId().toString(),
        role, // 'user' or 'assistant'
        content,
        timestamp: new Date(),
        metadata: {
          ...metadata,
          userId: userId || null,
          isAuthenticated: userId !== null
        }
      };

      const updateDoc = {
        $push: {
          messages: {
            $each: [message],
            $slice: -this.MAX_MESSAGES_PER_CONVERSATION
          }
        },
        $inc: { 'metadata.totalMessages': 1 },
        $set: { 
          updatedAt: new Date(),
          'metadata.lastActivity': new Date()
        }
      };

      // If this is the first message and we have a userId, set it
      if (userId) {
        updateDoc.$setOnInsert = { 
          userId: userId,
          isAuthenticated: true,
          'metadata.userType': 'authenticated'
        };
      } else {
        updateDoc.$setOnInsert = { 
          userId: null,
          isAuthenticated: false,
          'metadata.userType': 'anonymous'
        };
      }

      const result = await collection.updateOne(
        { sessionId },
        updateDoc,
        { upsert: true }
      );

      return { success: true, messageId: message.id };
    } catch (error) {
      console.error('Error adding message:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async getConversationHistory(sessionId, limit = 20) {
    try {
      const collection = this.getCollection();
      const conversation = await collection.findOne(
        { sessionId },
        {
          projection: {
            messages: { $slice: -limit }, // Get last N messages
            metadata: 1
          }
        }
      );

      if (!conversation) {
        return { success: true, messages: [], metadata: null };
      }

      return {
        success: true,
        messages: conversation.messages || [],
        metadata: conversation.metadata
      };
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async updateConversationMetadata(sessionId, metadata) {
    try {
      const collection = this.getCollection();
      await collection.updateOne(
        { sessionId },
        {
          $set: {
            'metadata.lastActivity': new Date(),
            updatedAt: new Date(),
            ...Object.keys(metadata).reduce((acc, key) => {
              acc[`metadata.${key}`] = metadata[key];
              return acc;
            }, {})
          }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error updating conversation metadata:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async deleteConversation(sessionId) {
    try {
      const collection = this.getCollection();
      const result = await collection.deleteOne({ sessionId });
      return { success: true, deletedCount: result.deletedCount };
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async cleanupOldConversations(daysOld = 30) {
    try {
      const collection = this.getCollection();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await collection.deleteMany({
        'metadata.lastActivity': { $lt: cutoffDate }
      });

      console.log(`Cleaned up ${result.deletedCount} old conversations`);
      return { success: true, deletedCount: result.deletedCount };
    } catch (error) {
      console.error('Error cleaning up old conversations:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }

  static async getConversationStats() {
    try {
      const collection = this.getCollection();
      const pipeline = [
        {
          $group: {
            _id: null,
            totalConversations: { $sum: 1 },
            totalMessages: { $sum: '$metadata.totalMessages' },
            avgMessagesPerConversation: { $avg: '$metadata.totalMessages' }
          }
        }
      ];

      const stats = await collection.aggregate(pipeline).toArray();
      return {
        success: true,
        stats: stats[0] || {
          totalConversations: 0,
          totalMessages: 0,
          avgMessagesPerConversation: 0
        }
      };
    } catch (error) {
      console.error('Error getting conversation stats:', error);
      return { success: false, errorCode: 'DB_ERROR', error: error.message };
    }
  }
}
