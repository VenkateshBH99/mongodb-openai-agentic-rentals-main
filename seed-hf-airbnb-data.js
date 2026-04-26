const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Use Node.js built-in fetch (available in Node.js 18+)
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

// Load environment variables from .env or .env.local
function loadEnvFile() {
  const envFiles = ['.env.local', '.env'];
  
  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envLines = envContent.split('\n');
      
      for (const line of envLines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            process.env[key] = valueParts.join('=');
          }
        }
      }
      console.log(`📄 Loaded environment from: ${envFile}`);
      return;
    }
  }
}

// Helper function to process and insert data
async function processAndInsertData(data, collection, sourceFile) {
  console.log(`🔄 Processing ${data.length} records from ${sourceFile}...`);
  
  // Process and transform data for rental app
  const processedData = data.map((item, index) => {
    try {
      // Transform the data to match our rental schema
      const rental = {
        // Add metadata first
        imported_at: new Date(),
        updated_at: new Date(),
        source: 'huggingface_airbnb_embeddings',
        source_file: sourceFile
      };
      
      // Safely copy properties from item
      if (item && typeof item === 'object') {
        // Copy specific known fields to avoid "too many properties" issue
        const fieldsToExtract = [
          'name', 'summary', 'description', 'price', 'property_type', 
          'room_type', 'accommodates', 'bedrooms', 'bathrooms', 'beds',
          'address', 'host', 'amenities', 'images', 'reviews',
          'embedding_with_metadata', 'listing_url', 'neighborhood_overview'
        ];
        
        for (const field of fieldsToExtract) {
          if (item.hasOwnProperty(field)) {
            rental[field] = item[field];
          }
        }
        
        // If the item has other properties, copy them selectively
        const itemKeys = Object.keys(item);
        if (itemKeys.length < 100) { // Safety check to avoid too many properties
          for (const key of itemKeys) {
            if (!rental.hasOwnProperty(key)) {
              rental[key] = item[key];
            }
          }
        }
      }
      
      // Ensure required fields are properly formatted
      if (rental.price && typeof rental.price === 'string') {
        rental.price = parseFloat(rental.price.replace(/[$,]/g, '')) || 0;
      }
      
      if (rental.bedrooms && typeof rental.bedrooms === 'string') {
        rental.bedrooms = parseInt(rental.bedrooms) || 0;
      }
      
      if (rental.bathrooms && typeof rental.bathrooms === 'string') {
        rental.bathrooms = parseFloat(rental.bathrooms) || 0;
      }
      
      if (rental.accommodates && typeof rental.accommodates === 'string') {
        rental.accommodates = parseInt(rental.accommodates) || 1;
      }
      
      return rental;
    } catch (itemError) {
      console.warn(`⚠️  Error processing item ${index}:`, itemError.message);
      return null;
    }
  }).filter(item => item !== null); // Remove failed items
  
  console.log(`✅ Successfully processed ${processedData.length} records`);
  
  // Insert in batches
  const batchSize = 1000;
  let totalInserted = 0;
  
  for (let i = 0; i < processedData.length; i += batchSize) {
    const batch = processedData.slice(i, i + batchSize);
    
    console.log(`📥 Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(processedData.length/batchSize)} (${batch.length} records)...`);
    
    const result = await collection.insertMany(batch, { 
      ordered: false // Continue on errors
    });
    
    totalInserted += result.insertedCount;
    console.log(`✅ Inserted ${result.insertedCount} records. Total: ${totalInserted}`);
  }
  
  return totalInserted;
}

// Load environment variables
loadEnvFile();

// MongoDB connection URI - must be set in .env file
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('❌ MONGODB_URI not found in environment variables.');
  console.error('Please set MONGODB_URI in your .env or .env.local file');
  process.exit(1);
}

async function seedHuggingFaceData() {
  const client = new MongoClient(uri);
  
  try {
    console.log('🔌 Connecting to MongoDB Atlas...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const db = client.db('rental_app');
    const collection = db.collection('rentals');
    
    // Check if collection already has data
    const existingCount = await collection.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠️  Collection already contains ${existingCount} documents`);
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('Do you want to clear existing data? (y/N): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        console.log('🗑️  Clearing existing data...');
        await collection.deleteMany({});
        console.log('✅ Collection cleared');
      } else {
        console.log('❌ Aborted - keeping existing data');
        return;
      }
    }
    
    console.log('🤗 Fetching data from Hugging Face dataset: MongoDB/airbnb_embeddings...');
    
    const datasetRepo = 'MongoDB/airbnb_embeddings';
    console.log(`📊 Accessing dataset: ${datasetRepo}`);
    
    let totalInserted = 0;
    
    // Try to access the dataset using the Hugging Face datasets API endpoint with pagination
    console.log('🔗 Trying Hugging Face datasets server API...');
    
    let offset = 0;
    const limit = 100; // API limit per request
    let hasMoreData = true;
    
    while (hasMoreData) {
      const datasetUrl = `https://datasets-server.huggingface.co/rows?dataset=${datasetRepo}&config=default&split=train&offset=${offset}&length=${limit}`;
      console.log(`📡 Fetching batch from offset ${offset}...`);
      
      const response = await fetch(datasetUrl);
      if (!response.ok) {
        throw new Error(`Dataset server returned ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const batchSize = result.rows?.length || 0;
      console.log(`📦 Found ${batchSize} records in this batch`);
      
      if (result.rows && result.rows.length > 0) {
        const data = result.rows.map(row => row.row);
        console.log(`✅ Successfully loaded ${data.length} records from batch`);
        
        // Process this batch
        const inserted = await processAndInsertData(data, collection, `dataset-server-api-batch-${Math.floor(offset/limit) + 1}`);
        totalInserted += inserted;
        
        // Check if we have more data
        if (batchSize < limit) {
          hasMoreData = false;
          console.log('📋 Reached end of dataset');
        } else {
          offset += limit;
          console.log(`➡️  Moving to next batch (offset: ${offset})`);
        }
      } else {
        hasMoreData = false;
        if (offset === 0) {
          throw new Error('No data found in dataset server response');
        }
      }
    }
    
    console.log(`\n🎉 Data seeding completed! Total inserted: ${totalInserted} documents`);
    
    if (totalInserted > 0) {
      // Create indexes for better query performance
      console.log('\n� Creating search indexes...');
      
      const indexes = [
        { keys: { price: 1 }, name: 'price_idx' },
        { keys: { property_type: 1 }, name: 'property_type_idx' },
        { keys: { room_type: 1 }, name: 'room_type_idx' },
        { keys: { accommodates: 1 }, name: 'accommodates_idx' },
        { keys: { bedrooms: 1 }, name: 'bedrooms_idx' },
        { keys: { bathrooms: 1 }, name: 'bathrooms_idx' },
        { keys: { 'address.country': 1 }, name: 'country_idx' },
        { keys: { 'address.market': 1 }, name: 'market_idx' },
        { keys: { 'host.host_is_superhost': 1 }, name: 'superhost_idx' },
        { keys: { name: 'text', summary: 'text', description: 'text' }, name: 'text_search_idx' }
      ];
      
      for (const index of indexes) {
        try {
          await collection.createIndex(index.keys, { name: index.name });
          console.log(`✅ Created index: ${index.name}`);
        } catch (error) {
          if (error.code === 85) {
            console.log(`ℹ️  Index ${index.name} already exists`);
          } else {
            console.error(`❌ Error creating index ${index.name}:`, error.message);
          }
        }
      }
      
      // Get final collection stats
      console.log('\n📊 Collection Statistics:');
      const finalCount = await collection.countDocuments();
      console.log(`Total documents: ${finalCount}`);
      
      // Sample document for verification
      const sampleDoc = await collection.findOne({});
      if (sampleDoc) {
        console.log('\n📋 Sample document structure:');
        console.log('Fields:', Object.keys(sampleDoc).join(', '));
        if (sampleDoc.embedding_with_metadata) {
          console.log('✅ Vector embeddings found');
        }
        if (sampleDoc.name) {
          console.log(`Sample name: ${sampleDoc.name}`);
        }
        if (sampleDoc.address) {
          console.log(`Sample location: ${sampleDoc.address.market || sampleDoc.address.country || 'Unknown'}`);
        }
      }
      
      // Data overview aggregation
      try {
        const overview = await collection.aggregate([
          {
            $group: {
              _id: null,
              total_rentals: { $sum: 1 },
              avg_price: { $avg: '$price' },
              min_price: { $min: '$price' },
              max_price: { $max: '$price' },
              unique_countries: { $addToSet: '$address.country' },
              unique_property_types: { $addToSet: '$property_type' }
            }
          }
        ]).toArray();
        
        if (overview.length > 0 && overview[0].total_rentals > 0) {
          console.log('\n📈 Data Overview:');
          console.log(`Total Rentals: ${overview[0].total_rentals}`);
          console.log(`Average Price: $${(overview[0].avg_price || 0).toFixed(2)}`);
          console.log(`Price Range: $${overview[0].min_price} - $${overview[0].max_price}`);
          console.log(`Countries: ${(overview[0].unique_countries || []).filter(Boolean).length}`);
          console.log(`Property Types: ${(overview[0].unique_property_types || []).filter(Boolean).length}`);
        }
      } catch (aggError) {
        console.log('⚠️  Could not generate overview (some fields may be missing)');
      }
    }
    
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🌱 Hugging Face Airbnb Data Seeder

Usage: node seed-hf-airbnb-data.js [options]

Options:
  --help, -h    Show this help message

Environment Variables:
  MONGODB_URI   MongoDB connection string (default: uses rental-app-user credentials)

This script downloads data from the MongoDB/airbnb_embeddings dataset on Hugging Face
and seeds it into the rental_app.rentals collection in MongoDB Atlas.
`);
  process.exit(0);
}

// Run the seeding
console.log('🚀 Starting Hugging Face Airbnb data seeding...');
seedHuggingFaceData();
