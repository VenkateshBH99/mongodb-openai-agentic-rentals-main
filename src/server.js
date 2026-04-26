/**
 * Elysia.js frontend server - serves static files and proxies
 * API calls to the Python Flask backend (app.py).
 */
import { Elysia } from 'elysia';
import { staticPlugin } from '@elysiajs/static';

const PYTHON_API = process.env.PYTHON_API || 'http://localhost:5001';

const app = new Elysia()
  .use(staticPlugin({
    assets: 'public',
    prefix: '/',
    noCache: true,
  }))

  .get('/', () => {
    return new Response(Bun.file('public/index.html').stream(), {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  })

  .get('/health', async () => {
    const res = await fetch(`${PYTHON_API}/health`);
    return res.json();
  })
  .get('/api', async () => {
    const res = await fetch(`${PYTHON_API}/api`);
    return res.json();
  })
  .get('/rentals', async ({ request }) => {
    const url = new URL(request.url);
    const res = await fetch(`${PYTHON_API}/rentals${url.search}`);
    return res.json();
  })
  .get('/rentals/:id', async ({ params }) => {
    const res = await fetch(`${PYTHON_API}/rentals/${params.id}`);
    return res.json();
  })
  .get('/search', async ({ request }) => {
    const url = new URL(request.url);
    const res = await fetch(`${PYTHON_API}/search${url.search}`);
    return res.json();
  })
  .get('/stats', async () => {
    const res = await fetch(`${PYTHON_API}/stats`);
    return res.json();
  })
  .get('/recommendations', async () => {
    const res = await fetch(`${PYTHON_API}/recommendations`);
    return res.json();
  })
  .get('/recommendations/:userId', async ({ params, request }) => {
    const url = new URL(request.url);
    const res = await fetch(`${PYTHON_API}/recommendations/${params.userId}${url.search}`);
    return res.json();
  })
  .get('/users/:userId', async ({ params }) => {
    const res = await fetch(`${PYTHON_API}/users/${params.userId}`);
    return res.json();
  })
  .get('/similar/:listingId', async ({ params, request }) => {
    const url = new URL(request.url);
    const res = await fetch(`${PYTHON_API}/similar/${params.listingId}${url.search}`);
    return res.json();
  })

  // Image upload search - proxy multipart to Python
  .post('/upload-search', async ({ request }) => {
    const formData = await request.formData();
    const res = await fetch(`${PYTHON_API}/upload-search`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  })

  // Serve local listing images
  .get('/images/:filename', async ({ params }) => {
    const res = await fetch(`${PYTHON_API}/images/${params.filename}`);
    if (!res.ok) return new Response('', { status: 404 });
    return new Response(await res.arrayBuffer(), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  })

  .listen(3001);

console.log('Frontend server running at http://localhost:3001');
console.log('Proxying API calls to Python backend at ' + PYTHON_API);
