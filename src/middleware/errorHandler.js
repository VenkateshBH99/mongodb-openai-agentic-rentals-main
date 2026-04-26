import { Elysia } from 'elysia';

export const errorHandler = new Elysia({ name: 'errorHandler' })
  .onError(({ code, error, set }) => {
    console.error(`[${new Date().toISOString()}] Error ${code}:`, error.message);
    
    switch (code) {
      case 'VALIDATION':
        set.status = 400;
        return {
          success: false,
          error: 'Validation failed',
          details: error.message
        };
        
      case 'NOT_FOUND':
        set.status = 404;
        return {
          success: false,
          error: 'Endpoint not found'
        };
        
      case 'PARSE':
        set.status = 400;
        return {
          success: false,
          error: 'Invalid JSON format'
        };
        
      case 'INTERNAL_SERVER_ERROR':
      default:
        set.status = 500;
        return {
          success: false,
          error: 'Internal server error',
          message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        };
    }
  });