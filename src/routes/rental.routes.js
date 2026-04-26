import { Elysia, t } from 'elysia';
import { RentalController } from '../controllers/rental.controller.js';

// Controller will be initialized after database connection
let rentalController;

// Initialize controller after database connection
export function initializeController() {
  rentalController = new RentalController();
}

// Helper function to check if controller is ready
function checkController() {
  if (!rentalController) {
    return new Response(JSON.stringify({ success: false, error: 'Service not ready' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return null;
}

// Validation schemas
const rentalSchema = t.Object({
  name: t.String({ minLength: 1 }),
  summary: t.Optional(t.String()),
  property_type: t.String(),
  room_type: t.Optional(t.String()),
  accommodates: t.Optional(t.Number({ minimum: 1 })),
  bedrooms: t.Optional(t.Number({ minimum: 0 })),
  bathrooms: t.Optional(t.Number({ minimum: 0 })),
  beds: t.Optional(t.Number({ minimum: 0 })),
  price: t.Number({ minimum: 0 }),
  minimum_nights: t.Optional(t.Number({ minimum: 1 })),
  maximum_nights: t.Optional(t.Number({ minimum: 1 })),
  instant_bookable: t.Optional(t.Boolean()),
  amenities: t.Optional(t.Array(t.String()))
});

const querySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  skip: t.Optional(t.Numeric({ minimum: 0 })),
  page: t.Optional(t.Numeric({ minimum: 1 })),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('1'), t.Literal('-1'), t.Literal(1), t.Literal(-1)])),
  text: t.Optional(t.String()),
  location: t.Optional(t.String()),
  property_type: t.Optional(t.String()),
  room_type: t.Optional(t.String()),
  country: t.Optional(t.String()),
  min_price: t.Optional(t.Numeric({ minimum: 0 })),
  max_price: t.Optional(t.Numeric({ minimum: 0 })),
  min_bedrooms: t.Optional(t.Numeric({ minimum: 0 })),
  min_bathrooms: t.Optional(t.Numeric({ minimum: 0 })),
  min_accommodates: t.Optional(t.Numeric({ minimum: 1 })),
  min_rating: t.Optional(t.Numeric({ minimum: 1, maximum: 5 })),
  superhost_only: t.Optional(t.String()),
  instant_bookable: t.Optional(t.String()),
  ids: t.Optional(t.String()) // Comma-separated list of rental IDs for AI search results
});

const idSchema = t.Object({
  id: t.String({ minLength: 1 }) // Accept any non-empty string ID
});

export const rentalRoutes = new Elysia({ prefix: '/rentals' })
  // GET /rentals - List rentals with filters
  .get('/', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.getAllRentals(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    query: querySchema,
    detail: {
      summary: 'Get all rentals',
      description: 'Retrieve rentals with optional filtering, sorting, and pagination',
      tags: ['Rentals']
    }
  })

  // GET /rentals/:id - Get single rental
  .get('/:id', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.getRentalById(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: result.statusCode || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    params: idSchema,
    detail: {
      summary: 'Get rental by ID',
      description: 'Retrieve detailed information about a specific rental',
      tags: ['Rentals']
    }
  })

  // POST /rentals - Create new rental
  .post('/', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.createRental(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: result.statusCode || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(result), {
      status: result.statusCode || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, {
    body: rentalSchema,
    detail: {
      summary: 'Create new rental',
      description: 'Add a new rental property to the database',
      tags: ['Rentals']
    }
  })

  // PUT /rentals/:id - Update rental
  .put('/:id', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.updateRental(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: result.statusCode || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    params: idSchema,
    body: t.Partial(rentalSchema),
    detail: {
      summary: 'Update rental',
      description: 'Update an existing rental property',
      tags: ['Rentals']
    }
  })

  // DELETE /rentals/:id - Delete rental
  .delete('/:id', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.deleteRental(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: result.statusCode || 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    params: idSchema,
    detail: {
      summary: 'Delete rental',
      description: 'Remove a rental property from the database',
      tags: ['Rentals']
    }
  });

// Search route (separate from main rentals route)
export const searchRoutes = new Elysia({ prefix: '/search' })
  .get('/', async (context) => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.searchRentals(context);
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    query: querySchema,
    detail: {
      summary: 'Advanced search',
      description: 'Search rentals with advanced filtering options',
      tags: ['Search']
    }
  });

// Stats route
export const statsRoutes = new Elysia({ prefix: '/stats' })
  .get('/', async () => {
    const notReady = checkController();
    if (notReady) return notReady;
    
    const result = await rentalController.getStats();
    
    if (!result.success) {
      return new Response(JSON.stringify(result), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return result;
  }, {
    detail: {
      summary: 'Get statistics',
      description: 'Retrieve rental statistics and analytics',
      tags: ['Analytics']
    }
  });