# MongoDB AI Rental Search Demo

A modern rental property search application powered by MongoDB Atlas Vector Search and OpenAI's Agents SDK for intelligent, conversational property discovery.

## Features

- 🤖 **AI-Powered Search**: Natural language queries like "6 bedroom rental in Manhattan under $1000"
- 🔍 **Vector Search**: Semantic search using MongoDB Atlas Vector Search with text embeddings
- 💬 **Conversational Interface**: Interactive AI assistant that maintains conversation context
- 🎯 **Smart Filtering**: AI automatically extracts and applies search criteria to UI filters
- 🔐 **User Authentication**: Secure JWT-based authentication with user profiles
- ❤️ **Save Favorites**: Bookmark favorite properties (requires authentication)
- 🗺️ **Multi-Market Support**: Properties across NYC, Barcelona, Montreal, Sydney, and more
- ⚡ **Real-time Updates**: Dynamic UI updates with visual feedback when AI applies filters

## Tech Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **Backend**: Elysia (high-performance web framework)
- **Database**: MongoDB Atlas with Vector Search
- **AI**: OpenAI Agents SDK with GPT-4o-mini
- **Authentication**: JWT (JSON Web Tokens) with bcrypt password hashing
- **Frontend**: Vanilla JavaScript with modern ES6+
- **Embeddings**: OpenAI text-embedding-3-small
- **API Documentation**: Swagger/OpenAPI

## Prerequisites

- [Bun](https://bun.sh/) installed
- MongoDB Atlas cluster (M10+ for Vector Search)
- OpenAI API key

## Quick Start

### 1. Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd mdb-claude-demo

# Install dependencies (works with Bun, npm, or yarn)
bun install
# or: npm install
# or: yarn install

# Dependencies for seeding are already included in package.json
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```env
# MongoDB Atlas Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/rental_app?retryWrites=true&w=majority

# OpenAI Configuration (Required for RAG Agent)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Application Configuration
NODE_ENV=development
PORT=3001

# JWT Configuration (Required for Authentication)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# Optional: Additional MongoDB Settings
MONGODB_DB_NAME=rental_app
MONGODB_COLLECTION_NAME=rentals
```

### 4. MongoDB Atlas Setup

#### 4.1 Create Atlas Cluster
1. Go to [MongoDB Atlas](https://cloud.mongodb.com/)
2. Create a new cluster (M10+ required for Vector Search)
3. Set up database access credentials
4. Configure network access (allow your IP)

#### 4.2 Create Database and Collection
```javascript
// Database name: rental_app
// Collection name: rentals
```

#### 4.3 Create Vector Search Index

1. **Navigate to Atlas Search**:
   - Go to your Atlas cluster dashboard
   - Click on "Atlas Search" tab
   - Click "Create Search Index"

2. **Select Vector Search**:
   - Choose "Atlas Vector Search"
   - Select your database: `rental_app`
   - Select your collection: `rentals`

3. **Configure the Index**:
   - **Index Name**: `rental_vector_search`
   - Use the following JSON configuration:

```json
{
  "fields": [
    {
      "numDimensions": 1536,
      "path": "text_embeddings",
      "similarity": "cosine",
      "type": "vector"
    },
    {
      "path": "property_type",
      "type": "filter"
    },
    {
      "path": "address.market",
      "type": "filter"
    },
    {
      "path": "address.country",
      "type": "filter"
    },
    {
      "path": "price",
      "type": "filter"
    },
    {
      "path": "bedrooms",
      "type": "filter"
    },
    {
      "path": "accommodates",
      "type": "filter"
    },
    {
      "path": "host.host_is_superhost",
      "type": "filter"
    }
  ]
}
```

4. **Create and Wait**:
   - Click "Next" and then "Create Search Index"
   - Wait for the index to build (status shows "Active")

### 5. Data Seeding

**When to seed:** After setting up your MongoDB Atlas cluster and vector search index, but before running the application.

**⚠️ Important:** Make sure your vector search index is **Active** before seeding data.

#### Option 1: Hugging Face Dataset (Recommended)

Use the pre-embedded Airbnb dataset with vector embeddings published by MongoDB on Hugging Face:

```text
https://huggingface.co/datasets/MongoDB/airbnb_embeddings
```

```bash
# Seed the database with Hugging Face dataset
node seed-hf-airbnb-data.js
```

**What this does:**
- Downloads ~6000 Airbnb listings with pre-computed embeddings
- Populates `rental_app.rentals` collection
- Creates search indexes automatically
- Includes properties from multiple cities (NYC, Barcelona, Montreal, etc.)
- Ready for immediate vector search

**When to use:** 
- ✅ First time setup
- ✅ Demo/testing purposes  
- ✅ Want realistic data with embeddings
- ✅ Need to reset/refresh data

#### Option 2: Custom Data

If you have your own rental data, ensure documents follow this structure:

```javascript
{
  "_id": ObjectId("..."),
  "name": "Cozy Manhattan Apartment",
  "description": "Beautiful 2BR apartment in the heart of NYC...",
  "property_type": "Apartment",
  "room_type": "Entire home/apt",
  "price": 150,
  "bedrooms": 2,
  "bathrooms": 1,
  "accommodates": 4,
  "address": {
    "market": "New York",
    "neighbourhood": "Manhattan",
    "country": "United States"
  },
  "host": {
    "host_is_superhost": true,
    "host_name": "John"
  },
  "amenities": ["WiFi", "Kitchen", "Heating"],
  "text_embeddings": [0.1234, -0.5678, ...], // 1536-dimensional array
  "review_scores": {
    "review_scores_rating": 95
  },
  "number_of_reviews": 42
}
```

**Seeding Workflow:**
1. Set up MongoDB Atlas cluster (M10+)
2. Create vector search index (wait for "Active" status)
3. Configure `.env` with connection string
4. Run: `node seed-hf-airbnb-data.js`
5. Start the application: `bun start`

**Re-seeding:** The script will prompt before clearing existing data, so it's safe to run multiple times.

## Running the Application

### Development Mode

```bash
# Start with hot reload
bun run dev

# Or start normally
bun start

# With watch mode (restarts on file changes)
bun --watch server.js
```

### Production Mode

```bash
# Set production environment
export NODE_ENV=production

# Start the server
bun start
```

### Using Different Package Managers

If you prefer npm or yarn:

```bash
# With npm
npm install
npm start

# With yarn
yarn install
yarn start
```

### Verify Setup

1. **Server Running**: Check `http://localhost:3000`
2. **Database Connection**: Look for "Connected to MongoDB Atlas" in console
3. **Vector Index**: Verify index status is "Active" in Atlas dashboard
4. **AI Chat**: Test the assistant with "Hello" message

## Project Structure

```
├── src/
│   ├── agents/
│   │   └── rental-rag-agent.js      # OpenAI Agents SDK integration
│   ├── controllers/
│   │   ├── chat.controller.js       # Chat API endpoints
│   │   └── rental.controller.js     # Rental CRUD operations
│   ├── models/
│   │   └── conversation.js          # Conversation persistence
│   ├── routes/
│   │   ├── chat.routes.js          # Chat API routes
│   │   └── rental.routes.js        # Rental API routes
│   ├── services/
│   │   └── vector-search.service.js # MongoDB Vector Search
│   └── config/
│       └── database.js             # MongoDB connection
├── public/
│   ├── index.html                  # Main UI
│   ├── script.js                   # Frontend logic
│   └── styles.css                  # Styling
└── server.js                       # Main server file
```

## Available Markets

The demo includes rental properties in these markets:
- **New York** (United States) - 607 properties
- **Barcelona** (Spain) - 632 properties  
- **Montreal** (Canada) - 648 properties
- **Hong Kong** - 619 properties
- **Sydney** (Australia) - 609 properties
- **Istanbul** (Turkey) - 660 properties
- **Rio De Janeiro** (Brazil) - 603 properties
- **Porto** (Portugal) - 554 properties
- **Hawaiian Islands** (Oahu, Maui, Big Island, Kauai)

## AI Assistant Usage

The AI assistant understands natural language queries:

- "Find me a 2 bedroom apartment in Barcelona under €200 per night"
- "Show superhosts only in Manhattan"
- "I need something for 6 people in Sydney with good reviews"
- "What's available in Montreal for a family vacation?"

The assistant will:
1. Extract search criteria from your message
2. Apply filters to the UI automatically
3. Execute the search and show results
4. Provide conversational follow-up and recommendations

## API Endpoints

### Rentals
- `GET /rentals` - List all rentals with filtering
- `GET /rentals/:id` - Get specific rental details
- `GET /search` - Advanced search with multiple filters

### Chat
- `POST /chat` - Send message to AI assistant
- `GET /chat/history/:sessionId` - Get conversation history

### Analytics
- `GET /stats` - Get rental statistics

## Troubleshooting

### Common Issues

1. **"Service not ready" error**:
   - Check MongoDB connection string in `.env`
   - Verify network access in Atlas
   - Ensure database and collection exist

2. **Vector Search not working**:
   - Verify index is "Active" in Atlas dashboard
   - Check index name matches `rental_vector_search`
   - Ensure collection has `text_embeddings` field

3. **AI not responding**:
   - Verify OpenAI API key is correct
   - Check API usage limits and billing
   - Look for error messages in server console

4. **Bun command not found**:
   - Reinstall Bun following the installation guide
   - Check PATH configuration
   - Try restarting terminal/shell

### Debug Mode

Set environment variables for detailed logging:

```bash
export NODE_ENV=development
export DEBUG=*
bun start
```

### Performance Tips

- Use Bun's fast startup time for development
- Enable MongoDB connection pooling for production
- Consider caching frequent vector search results
- Monitor OpenAI API usage and implement rate limiting

## Development

### Hot Reload Development

```bash
# Install nodemon for Node.js compatibility
bun add -d nodemon

# Run with hot reload
bun run dev
```

### Adding New Features

1. **New AI Tools**: Add tools to `src/agents/rental-rag-agent.js`
2. **API Endpoints**: Create routes in `src/routes/`
3. **Database Models**: Add to `src/models/`
4. **Frontend Features**: Update `public/script.js`

### Testing Vector Search

Use the MongoDB shell or Compass to test vector search:

```javascript
db.rentals.aggregate([
  {
    $vectorSearch: {
      index: "rental_vector_search",
      path: "text_embeddings",
      queryVector: [/* your 1536-dim embedding array */],
      numCandidates: 100,
      limit: 5
    }
  }
]);
```

## License

This project is for demonstration purposes. Check individual dependencies for their respective licenses.
