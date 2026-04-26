import { rentalRAGAgent } from '../agents/rental-rag-agent.js';
import { ConversationModel } from '../models/conversation.js';
import { UserModel } from '../models/user.js';
import { ObjectId } from 'mongodb';

export class ChatController {
  constructor() {
    // Generate session ID if not provided
    this.generateSessionId = () => new ObjectId().toString();
  }

  async handleChatMessage({ message, conversation_history = [], context = {}, sessionId = null, userId = null }) {
    try {
      console.log('Processing chat message:', message.substring(0, 100) + '...');
      
      // Generate session ID if not provided
      if (!sessionId) {
        sessionId = this.generateSessionId();
      }

      // Get conversation history from MongoDB if not provided
      let historyToUse = conversation_history;
      if (conversation_history.length === 0) {
        const historyResult = await ConversationModel.getConversationHistory(sessionId);
        if (historyResult.success) {
          historyToUse = historyResult.messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }));
        }
      }

      // Store user message in MongoDB (with userId if authenticated)
      await ConversationModel.addMessage(sessionId, 'user', message, {
        context,
        timestamp: new Date().toISOString()
      }, userId);

      // Track user activity if authenticated
      if (userId) {
        await this.trackUserActivity(userId, 'chat_message', { 
          message_length: message.length,
          has_context: Object.keys(context).length > 0
        });
      }
      
      // Enhance message with context if available
      let enhancedMessage = message;
      if (context.current_search) {
        enhancedMessage = `User is currently searching for: "${context.current_search}". ${message}`;
      }
      
      if (context.filters && Object.keys(context.filters).length > 0) {
        const filterDesc = this.formatFilters(context.filters);
        enhancedMessage += ` Current filters: ${filterDesc}.`;
      }

      if (context.current_property) {
        const property = context.current_property;
        const locationStr = property.location ? `${property.location.neighbourhood || property.location.market || ''}, ${property.location.country || ''}`.replace(/^, /, '') : 'Unknown location';
        enhancedMessage += ` User is currently viewing property: "${property.name}" (ID: ${property.id}) - ${property.features.property_type || 'Property'} for $${property.price}/night in ${locationStr}, ${property.features.bedrooms || 0} bedrooms, accommodates ${property.features.accommodates || 0} guests.`;
      }

      // Get response from RAG agent
      const response = await rentalRAGAgent.chat(enhancedMessage, historyToUse, userId);
      
      if (!response.success) {
        // Still store the error response for debugging
        await ConversationModel.addMessage(sessionId, 'assistant', response.message, {
          error: true,
          error_details: response.error
        }, userId);

        return {
          success: false,
          message: response.message,
          error: response.error,
          sessionId
        };
      }

      // Store assistant response in MongoDB
      await ConversationModel.addMessage(sessionId, 'assistant', response.message, {
        tool_calls_made: response.toolCalls?.length || 0,
        has_rental_results: response.metadata?.search_performed || false,
        search_metadata: response.metadata || {},
        timestamp: new Date().toISOString()
      }, userId);

      // Track search activity if authenticated and search was performed
      if (userId && response.metadata?.search_performed) {
        await this.trackUserActivity(userId, 'search_performed', {
          search_query: enhancedMessage,
          results_count: response.metadata.results_count || 0,
          filters_used: context.filters || {}
        });
        
        // Add to user's search history
        await UserModel.addToSearchHistory(userId, message, context.filters || {});
      }

      // Update conversation metadata
      await ConversationModel.updateConversationMetadata(sessionId, {
        lastUserMessage: message,
        lastAssistantResponse: response.message,
        toolCallsInSession: (response.toolCalls?.length || 0),
        lastSearchMetadata: response.metadata || {},
        isAuthenticated: userId !== null,
        userId: userId
      });

      // Increment user conversation stats if authenticated
      if (userId) {
        await UserModel.incrementUserStats(userId, 'total_conversations');
      }

      return {
        success: true,
        message: response.message,
        sessionId,
        timestamp: new Date().toISOString(),
        context: {
          tool_calls_made: response.toolCalls?.length || 0,
          has_rental_results: response.metadata?.search_performed || false,
          search_metadata: response.metadata || {}
        }
      };
    } catch (error) {
      console.error('Error in chat controller:', error);
      
      // Try to log error to conversation if we have a sessionId
      if (sessionId) {
        try {
          await ConversationModel.addMessage(sessionId, 'assistant', 
            "I'm having trouble processing your request right now. Please try again.", 
            { 
              error: true, 
              error_details: error.message 
            },
            userId
          );
        } catch (logError) {
          console.error('Failed to log error to conversation:', logError);
        }
      }

      return {
        success: false,
        message: "I'm having trouble processing your request right now. Please try again.",
        sessionId: sessionId || this.generateSessionId(),
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }

  async handleStreamChat({ message, conversation_history = [], context = {}, sessionId = null, userId = null }) {
    try {
      console.log('Processing stream chat message:', message.substring(0, 100) + '...');
      
      // Generate session ID if not provided
      if (!sessionId) {
        sessionId = this.generateSessionId();
      }

      // Get conversation history from MongoDB if not provided
      let historyToUse = conversation_history;
      if (conversation_history.length === 0) {
        const historyResult = await ConversationModel.getConversationHistory(sessionId);
        if (historyResult.success) {
          historyToUse = historyResult.messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }));
        }
      }

      // Store user message in MongoDB
      await ConversationModel.addMessage(sessionId, 'user', message, {
        context,
        stream_request: true,
        timestamp: new Date().toISOString()
      }, userId);

      // Track user activity if authenticated
      if (userId) {
        await this.trackUserActivity(userId, 'stream_chat_message', { 
          message_length: message.length,
          has_context: Object.keys(context).length > 0
        });
      }
      
      // Enhance message with context
      let enhancedMessage = message;
      if (context.current_search) {
        enhancedMessage = `User is currently searching for: "${context.current_search}". ${message}`;
      }
      
      if (context.filters && Object.keys(context.filters).length > 0) {
        const filterDesc = this.formatFilters(context.filters);
        enhancedMessage += ` Current filters: ${filterDesc}.`;
      }

      // Get streaming response from RAG agent
      const stream = await rentalRAGAgent.streamChat(enhancedMessage, historyToUse);
      
      return {
        success: true,
        stream: stream,
        sessionId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in stream chat controller:', error);
      
      // Try to log error to conversation if we have a sessionId
      if (sessionId) {
        try {
          await ConversationModel.addMessage(sessionId, 'assistant', 
            "I'm having trouble processing your streaming request.", 
            { 
              error: true, 
              stream_request: true,
              error_details: error.message 
            },
            userId
          );
        } catch (logError) {
          console.error('Failed to log error to conversation:', logError);
        }
      }
      
      throw error;
    }
  }

  formatFilters(filters) {
    const descriptions = [];
    
    if (filters.property_type) {
      descriptions.push(`property type: ${filters.property_type}`);
    }
    if (filters.min_price || filters.max_price) {
      if (filters.min_price && filters.max_price) {
        descriptions.push(`price: $${filters.min_price}-$${filters.max_price}/night`);
      } else if (filters.min_price) {
        descriptions.push(`minimum price: $${filters.min_price}/night`);
      } else {
        descriptions.push(`maximum price: $${filters.max_price}/night`);
      }
    }
    if (filters.min_bedrooms) {
      descriptions.push(`${filters.min_bedrooms}+ bedrooms`);
    }
    if (filters.min_accommodates) {
      descriptions.push(`${filters.min_accommodates}+ guests`);
    }
    if (filters.superhost_only === 'true') {
      descriptions.push('superhosts only');
    }
    
    return descriptions.join(', ');
  }

  checkForRentalResults(message) {
    // Simple heuristic to check if the message contains rental results
    const indicators = [
      'found', 'properties', 'rentals', 'bedrooms', 'price', 'location',
      'accommodation', 'apartment', 'house', 'superhost', '$'
    ];
    
    const lowerMessage = message.toLowerCase();
    return indicators.some(indicator => lowerMessage.includes(indicator));
  }

  // MongoDB-based conversation methods
  async getConversationHistory(sessionId, limit = 20) {
    const result = await ConversationModel.getConversationHistory(sessionId, limit);
    if (result.success) {
      return result.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata
      }));
    }
    return [];
  }

  async deleteConversation(sessionId) {
    return await ConversationModel.deleteConversation(sessionId);
  }

  async getConversationStats() {
    return await ConversationModel.getConversationStats();
  }

  async cleanupOldConversations(daysOld = 30) {
    return await ConversationModel.cleanupOldConversations(daysOld);
  }

  // User activity tracking method
  async trackUserActivity(userId, activityType, metadata = {}) {
    try {
      // Update user profile with activity timestamp
      const activityData = {
        [`last_${activityType}`]: new Date(),
        ...metadata
      };

      await UserModel.updateUserProfile(userId, activityData);

      // Increment relevant stats
      if (activityType === 'search_performed') {
        await UserModel.incrementUserStats(userId, 'total_searches');
      }

      console.log(`Tracked activity for user ${userId}: ${activityType}`);
    } catch (error) {
      console.error('Error tracking user activity:', error);
      // Don't throw error - activity tracking shouldn't break the main flow
    }
  }
}
