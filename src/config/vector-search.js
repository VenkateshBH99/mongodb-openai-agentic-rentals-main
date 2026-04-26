// Vector Search Index Configuration for MongoDB Atlas
// This configuration is used to create the vector search index via Atlas UI or API

export const VECTOR_SEARCH_INDEX_CONFIG = {
  // Index name
  name: "rental_vector_search",
  
  // Collection to index
  collection: "rentals",
  
  // Database
  database: "rental_app",
  
  // Vector Search Index Definition
  definition: {
    "fields": [
      {
        "type": "vector",
        "path": "text_embeddings",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "property_type"
      },
      {
        "type": "filter", 
        "path": "room_type"
      },
      {
        "type": "filter",
        "path": "address.country"
      },
      {
        "type": "filter",
        "path": "price"
      },
      {
        "type": "filter",
        "path": "bedrooms"
      },
      {
        "type": "filter",
        "path": "bathrooms"
      },
      {
        "type": "filter",
        "path": "accommodates"
      },
      {
        "type": "filter",
        "path": "host.host_is_superhost"
      }
    ]
  }
};

// Atlas CLI command to create the index:
// atlas clusters search indexes create --clusterName ILCluster --file vector-search-index.json

// Or use the Atlas UI:
// 1. Go to Atlas Dashboard
// 2. Navigate to your cluster
// 3. Click "Search" tab
// 4. Click "Create Search Index"
// 5. Choose "JSON Editor"
// 6. Paste the definition above

export const SEARCH_INDEX_JSON = `{
  "fields": [
    {
      "type": "vector",
      "path": "text_embeddings", 
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "property_type"
    },
    {
      "type": "filter",
      "path": "room_type"
    },
    {
      "type": "filter", 
      "path": "address.country"
    },
    {
      "type": "filter",
      "path": "price"
    },
    {
      "type": "filter",
      "path": "bedrooms"
    },
    {
      "type": "filter",
      "path": "bathrooms"
    },
    {
      "type": "filter",
      "path": "accommodates"
    },
    {
      "type": "filter",
      "path": "host.host_is_superhost"
    }
  ]
}`;