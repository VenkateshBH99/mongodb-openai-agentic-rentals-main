import { Elysia } from 'elysia';

export const corsMiddleware = new Elysia({ name: 'cors' })
  .onRequest(({ request, set }) => {
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      set.headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      };
      return new Response(null, { status: 204 });
    }
  })
  .onAfterHandle(({ set }) => {
    // Add CORS headers to all responses
    set.headers = {
      ...set.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
  });