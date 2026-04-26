import { Elysia, t } from 'elysia';
import { rentalRAGAgent } from '../agents/rental-rag-agent.js';
import { AuthMiddleware } from '../middleware/auth.js';

let chatController;

async function initializeChatController() {
  if (!chatController) {
    const { ChatController } = await import('../controllers/chat.controller.js');
    chatController = new ChatController();
  }
  return chatController;
}

// Helper function to extract user info from optional auth
async function extractUserInfo(headers) {
  try {
    const authHeader = headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const decoded = AuthMiddleware.verifyToken(token);
      if (decoded) {
        return decoded.userId;
      }
    }
    return null;
  } catch (error) {
    // Ignore auth errors for optional auth
    return null;
  }
}

export const chatRoutes = new Elysia({ prefix: '/chat' })
  .post('/', async ({ body, headers }) => {
    try {
      const controller = await initializeChatController();
      const userId = await extractUserInfo(headers);
      
      // Add userId to the request body
      const requestData = { ...body, userId };
      
      return await controller.handleChatMessage(requestData);
    } catch (error) {
      console.error('Chat route error:', error);
      return {
        success: false,
        message: "I'm experiencing technical difficulties. Please try again later.",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }, {
    body: t.Object({
      message: t.String({ minLength: 1, maxLength: 1000 }),
      sessionId: t.Optional(t.Union([t.String(), t.Null()])),
      conversation_history: t.Optional(t.Array(t.Object({
        role: t.String(),
        content: t.String()
      }))),
      context: t.Optional(t.Object({
        current_search: t.Optional(t.String()),
        filters: t.Optional(t.Object({})),
        user_preferences: t.Optional(t.Object({}))
      }))
    })
  })
  
  .post('/stream', async ({ body, headers }) => {
    try {
      const controller = await initializeChatController();
      const userId = await extractUserInfo(headers);
      
      // Add userId to the request body
      const requestData = { ...body, userId };
      
      return await controller.handleStreamChat(requestData);
    } catch (error) {
      console.error('Chat stream route error:', error);
      return {
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }, {
    body: t.Object({
      message: t.String({ minLength: 1, maxLength: 1000 }),
      sessionId: t.Optional(t.Union([t.String(), t.Null()])),
      conversation_history: t.Optional(t.Array(t.Object({
        role: t.String(),
        content: t.String()
      }))),
      context: t.Optional(t.Object({
        current_search: t.Optional(t.String()),
        filters: t.Optional(t.Object({})),
        user_preferences: t.Optional(t.Object({}))
      }))
    })
  })
  
  .get('/history/:sessionId', async ({ params: { sessionId }, query: { limit } }) => {
    try {
      const controller = await initializeChatController();
      const history = await controller.getConversationHistory(sessionId, parseInt(limit) || 20);
      return {
        success: true,
        sessionId,
        history,
        count: history.length
      };
    } catch (error) {
      console.error('Get history error:', error);
      return {
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  })

  .delete('/history/:sessionId', async ({ params: { sessionId } }) => {
    try {
      const controller = await initializeChatController();
      const result = await controller.deleteConversation(sessionId);
      return {
        success: result.success,
        sessionId,
        deleted: result.deletedCount > 0
      };
    } catch (error) {
      console.error('Delete conversation error:', error);
      return {
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  })

  .get('/stats', async () => {
    try {
      const controller = await initializeChatController();
      const stats = await controller.getConversationStats();
      return {
        success: stats.success,
        stats: stats.stats
      };
    } catch (error) {
      console.error('Get stats error:', error);
      return {
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  })

  .post('/cleanup', async ({ body: { daysOld } }) => {
    try {
      const controller = await initializeChatController();
      const result = await controller.cleanupOldConversations(daysOld || 30);
      return {
        success: result.success,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Cleanup error:', error);
      return {
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }, {
    body: t.Object({
      daysOld: t.Optional(t.Number({ minimum: 1, maximum: 365 }))
    })
  })

  .get('/health', () => ({
    success: true,
    message: 'Chat service is healthy',
    timestamp: new Date().toISOString()
  }));
