import { Elysia } from 'elysia';

export const logger = new Elysia({ name: 'logger' })
  .onRequest(({ request, path }) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${request.method} ${path}`);
  })
  .onAfterHandle(({ request, path, set }) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${request.method} ${path} - ${set.status || 200}`);
  });