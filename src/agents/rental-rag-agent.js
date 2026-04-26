import { Agent, tool, run, user } from '@openai/agents';
import { z } from 'zod';
import { vectorSearchService } from '../services/vector-search.service.js';
import { UserModel } from '../models/user.js';
import { RentalModel } from '../models/rental.js';

class RentalRAGAgent {
  constructor() {
    // Define the search rentals tool
    this.searchRentalsTool = tool({
      name: 'searchRentals',
      description: 'Search for rental properties using semantic search based on user preferences. IMPORTANT: Always include location in the query when user mentions a place.',
      parameters: z.object({
        query: z.string().describe('Natural language search query describing what the user is looking for. Include location context for better results.'),
        filters: z.object({
          property_type: z.string().nullable().optional().describe('Type of property (e.g., Apartment, House, Loft)'),
          room_type: z.string().nullable().optional().describe('Room type (e.g., Entire home/apt, Private room)'),
          min_price: z.number().nullable().optional().describe('Minimum price per night'),
          max_price: z.number().nullable().optional().describe('Maximum price per night'),
          min_bedrooms: z.number().nullable().optional().describe('Minimum number of bedrooms'),
          min_accommodates: z.number().nullable().optional().describe('Minimum number of guests'),
          superhost_only: z.boolean().nullable().optional().describe('Only show superhost properties'),
          location: z.string().nullable().optional().describe('City/Market filter - use exact market names like "New York", "Barcelona", "Montreal", etc.'),
          country: z.string().nullable().optional().describe('Country filter - only use when specifically filtering by country, not city')
        }).nullable().optional(),
        limit: z.number().default(5).describe('Maximum number of results to return')
      }),
      execute: this.handleSearchRentals.bind(this)
    });

    // Define the get property details tool
    this.getPropertyDetailsTool = tool({
      name: 'getPropertyDetails',
      description: 'Get detailed information about a specific rental property by its ID',
      parameters: z.object({
        propertyId: z.number().describe('The ID of the property to get details for')
      }),
      execute: this.handleGetPropertyDetails.bind(this)
    });

    // Define the get saved rentals tool
    this.getSavedRentalsTool = tool({
      name: 'getSavedRentals',
      description: 'Get the user\'s saved rental properties. Only works when user is authenticated. Use this to show saved rentals, compare saved properties, or help with decisions based on previously saved items.',
      parameters: z.object({
        includeDetails: z.boolean().default(false).describe('Whether to include full rental details or just basic saved info')
      }),
      execute: this.handleGetSavedRentals.bind(this)
    });

    // Create the agent with tools
    this.agent = new Agent({
      name: "RentalAssistant",
      model: "gpt-5-mini",
      instructions: `You are an AI rental assistant that helps users find perfect rental properties. You have access to a comprehensive database of rental properties with detailed information including descriptions, amenities, locations, pricing, and more.

Your primary capabilities:
1. Search for rentals based on user preferences using semantic search
2. Provide detailed information about specific properties
3. Access user's saved rental properties (when authenticated)
4. Compare properties and make recommendations
5. Answer questions about neighborhoods, amenities, and property features
6. Help with booking-related questions and guidance

Available Markets in Database:
The rental database contains properties in these specific markets (use these exact names for location searches):
- Istanbul (Turkey) - 660 properties
- Montreal (Canada) - 648 properties  
- Barcelona (Spain) - 632 properties
- Hong Kong - 619 properties
- Sydney (Australia) - 609 properties
- New York (United States) - 607 properties
- Rio De Janeiro (Brazil) - 603 properties
- Porto (Portugal) - 554 properties
- Oahu (Hawaii, US) - 253 properties
- Maui (Hawaii, US) - 153 properties
- The Big Island (Hawaii, US) - 139 properties
- Kauai (Hawaii, US) - 67 properties

Location Mapping Guidelines:
- When users mention "Manhattan", "NYC", or "New York City", use location: "New York" (NOT country)
- When users mention "Rio" or "Brazil", use location: "Rio De Janeiro"  
- When users mention "Hawaii" without specifying an island, use location: "Oahu" (most popular)
- When users mention unclear locations, suggest the closest available market
- Always use the exact market name from the list above in the 'location' filter parameter
- IMPORTANT: Use 'location' parameter for cities/markets, NOT 'country' parameter
- Only use 'country' parameter when specifically filtering by country (e.g., "properties in United States")

Guidelines:
- Always be helpful, friendly, and informative
- Use the rental data to provide accurate, specific information
- When making recommendations, explain why a property might be suitable
- If you don't find exact matches, suggest similar alternatives
- Include relevant details like price, location, amenities, and ratings
- Be proactive in asking clarifying questions to better help users
- Format property information in a clear, readable way using **markdown** for emphasis
- When showing multiple properties, present them in order of relevance/quality
- When user is viewing a specific property (indicated in context), provide targeted advice about that property
- Use markdown formatting like **bold**, *italic*, lists, and headers to make responses more readable
- For property comparisons, use tables or structured lists
- Include helpful tips about booking, neighborhoods, or amenities when relevant

Property Context Handling:
- When context includes a currently viewed property, acknowledge it naturally
- Provide specific insights about that property's features, location benefits, or booking advice  
- Suggest similar properties if asked, or answer questions about the current property
- Help with booking decisions, neighborhood information, or amenity explanations

Saved Rentals Context:
- Use getSavedRentals tool when users ask about their saved properties, favorites, or bookmarked rentals
- When users ask questions like "show me my saved rentals", "compare my saved properties", "what did I save?", "my bookmarked properties", or "saved rentals with full details", use this tool
- ALWAYS use includeDetails=true when users ask for comparisons, recommendations, or detailed information about saved properties
- Help users make decisions between their saved properties by highlighting differences in price, location, amenities, etc.
- If user isn't logged in, politely explain they need to log in to access saved rentals
- When users mention comparing a specific property with their saved rentals, use getSavedRentals with includeDetails=true

IMPORTANT: When you perform a property search using the searchRentals tool, you MUST include the metadata "search_performed: true" in your response. This helps the UI understand when search results are being presented.`,

      tools: [this.searchRentalsTool, this.getPropertyDetailsTool, this.getSavedRentalsTool]
    });
  }

  async handleSearchRentals({ query, filters = {}, limit = 5 }) {
    try {
      console.log('RAG Agent searching for:', query, 'with filters:', filters);
      
      const results = await vectorSearchService.hybridSearch(query, filters, limit);
      
      if (results.length === 0) {
        this.lastSearchResults = [];
        return "No rental properties found matching your criteria. Try adjusting your search terms or filters.";
      }

      // Store the raw results for metadata extraction
      this.lastSearchResults = results;

      // Format results for the agent
      const formattedResults = results.map((rental, index) => ({
        rank: index + 1,
        id: rental._id,
        name: rental.name,
        type: rental.property_type,
        room_type: rental.room_type,
        price: rental.price,
        bedrooms: rental.bedrooms,
        bathrooms: rental.bathrooms,
        accommodates: rental.accommodates,
        location: `${rental.address?.neighbourhood || rental.address?.market || ''}, ${rental.address?.country || ''}`.replace(/^, /, ''),
        rating: rental.review_scores?.review_scores_rating ? (rental.review_scores.review_scores_rating / 20).toFixed(1) : null,
        superhost: rental.host?.host_is_superhost,
        similarity_score: rental.score ? rental.score.toFixed(3) : null,
        description: rental.description ? rental.description.substring(0, 200) + '...' : 'No description available'
      }));

      return JSON.stringify({
        total_found: results.length,
        query_used: query,
        filters_applied: filters,
        results: formattedResults
      });
    } catch (error) {
      console.error('Error in handleSearchRentals:', error);
      this.lastSearchResults = [];
      return `I encountered an error while searching for rentals: ${error.message}. Please try again.`;
    }
  }

  async handleGetPropertyDetails({ propertyId }) {
    try {
      console.log('RAG Agent getting details for property:', propertyId);
      
      const property = await vectorSearchService.getPropertyById(propertyId);
      
      if (!property) {
        return `Property with ID ${propertyId} not found.`;
      }

      // Format detailed property information
      const details = {
        id: property._id,
        name: property.name,
        description: property.description,
        property_type: property.property_type,
        room_type: property.room_type,
        price: property.price,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        accommodates: property.accommodates,
        location: {
          neighbourhood: property.address?.neighbourhood,
          market: property.address?.market,
          country: property.address?.country,
          full_address: `${property.address?.neighbourhood || property.address?.market || ''}, ${property.address?.country || ''}`.replace(/^, /, '')
        },
        amenities: property.amenities || [],
        host: {
          name: property.host?.host_name,
          is_superhost: property.host?.host_is_superhost,
          response_time: property.host?.host_response_time,
          response_rate: property.host?.host_response_rate
        },
        reviews: {
          rating: property.review_scores?.review_scores_rating ? (property.review_scores.review_scores_rating / 20).toFixed(1) : null,
          count: property.number_of_reviews,
          cleanliness: property.review_scores?.review_scores_cleanliness,
          communication: property.review_scores?.review_scores_communication,
          location_score: property.review_scores?.review_scores_location
        },
        policies: {
          cancellation_policy: property.cancellation_policy,
          minimum_nights: property.minimum_nights,
          maximum_nights: property.maximum_nights
        },
        availability: {
          instant_bookable: property.instant_bookable,
          calendar_updated: property.calendar_updated
        }
      };

      return JSON.stringify(details);
    } catch (error) {
      console.error('Error in handleGetPropertyDetails:', error);
      return `I encountered an error while getting property details: ${error.message}. Please try again.`;
    }
  }

  async handleGetSavedRentals({ includeDetails = false }) {
    try {
      console.log('RAG Agent getting saved rentals, includeDetails:', includeDetails);
      
      // This method needs access to the user ID from context
      // The user ID should be passed in from the chat controller
      const userId = this.currentUserId;
      
      if (!userId) {
        return "I can only access your saved rentals when you're logged in. Please log in to see your saved properties.";
      }

      const result = await UserModel.getSavedRentals(userId);
      
      if (!result.success) {
        return `I encountered an error accessing your saved rentals: ${result.error}. Please try again.`;
      }

      const savedRentals = result.savedRentals || [];
      
      if (savedRentals.length === 0) {
        return "You don't have any saved rental properties yet. When you find properties you like, you can save them to your list!";
      }

      // If detailed info requested, fetch full rental data
      if (includeDetails) {
        const rentalModel = new RentalModel();
        const detailedRentals = await Promise.all(
          savedRentals.map(async (saved) => {
            try {
              const result = await rentalModel.findById(saved.rental_id);
              return {
                ...saved,
                full_rental_data: (result.success ? result.data : null) || saved.rental_data // Fallback to saved basic data
              };
            } catch (error) {
              console.error(`Error fetching rental ${saved.rental_id}:`, error);
              return saved; // Return basic saved data if full fetch fails
            }
          })
        );
        
        return JSON.stringify({
          total_saved: detailedRentals.length,
          saved_rentals: detailedRentals.map((saved, index) => ({
            rank: index + 1,
            id: saved.rental_id,
            saved_at: saved.saved_at,
            name: saved.full_rental_data?.name || saved.rental_data?.name,
            type: saved.full_rental_data?.property_type || saved.rental_data?.property_type,
            price: saved.full_rental_data?.price || saved.rental_data?.price,
            location: saved.full_rental_data ? 
              `${saved.full_rental_data.address?.neighbourhood || saved.full_rental_data.address?.market || ''}, ${saved.full_rental_data.address?.country || ''}`.replace(/^, /, '') :
              saved.rental_data?.location,
            bedrooms: saved.full_rental_data?.bedrooms,
            bathrooms: saved.full_rental_data?.bathrooms,
            accommodates: saved.full_rental_data?.accommodates,
            rating: saved.full_rental_data?.review_scores?.review_scores_rating ? (saved.full_rental_data.review_scores.review_scores_rating / 20).toFixed(1) : null,
            superhost: saved.full_rental_data?.host?.host_is_superhost,
            description: saved.full_rental_data?.description ? saved.full_rental_data.description.substring(0, 200) + '...' : 'No description available'
          }))
        });
      } else {
        // Return basic saved info only
        return JSON.stringify({
          total_saved: savedRentals.length,
          saved_rentals: savedRentals.map((saved, index) => ({
            rank: index + 1,
            id: saved.rental_id,
            saved_at: saved.saved_at,
            name: saved.rental_data?.name || 'Unknown Property',
            type: saved.rental_data?.property_type || 'Unknown Type',
            price: saved.rental_data?.price || null,
            location: saved.rental_data?.location || 'Unknown Location',
            image: saved.rental_data?.image || null
          }))
        });
      }
    } catch (error) {
      console.error('Error in handleGetSavedRentals:', error);
      return `I encountered an error while getting your saved rentals: ${error.message}. Please try again.`;
    }
  }

  async chat(userMessage, conversationHistory = [], userId = null) {
    try {
      console.log('RAG Agent processing message:', userMessage);
      console.log('RAG Agent conversation history length:', conversationHistory.length);
      console.log('RAG Agent user ID:', userId);
      
      // Set the current user ID for the saved rentals tool
      this.currentUserId = userId;
      
      // Convert simple conversation history to OpenAI Agents format
      let history = [];
      
      // Convert existing conversation history to proper format
      if (conversationHistory && conversationHistory.length > 0) {
        history = conversationHistory.map(msg => {
          if (msg.role === 'user') {
            return user(msg.content);
          }
          // For assistant messages, we can't easily reconstruct them
          // Skip them for now and let the agent handle context
          return null;
        }).filter(Boolean);
      }
      
      // Add current user message
      history.push(user(userMessage));
      
      // Use the standalone run function with proper history format
      const result = await run(this.agent, history);

      // Extract tool calls from the OpenAI Agents SDK structure
      const extractedToolCalls = this.extractToolCallsFromResult(result);
      
      // Check if any search tools were called
      const searchPerformed = extractedToolCalls?.some(call => 
        call.name === 'searchRentals' || call.name === 'getPropertyDetails'
      ) || false;

      // Also check the message content for search indicators
      const messageHasSearchResults = result.finalOutput?.includes('*search_performed: true*') || 
                                     result.finalOutput?.includes('search_performed: true') ||
                                     result.finalOutput?.includes('Search performed: true') ||
                                     searchPerformed;

      // Extract search metadata if available
      const searchMetadata = this.extractSearchMetadata(extractedToolCalls, userMessage, result.finalOutput);

      console.log('RAG Agent Debug:', {
        extractedToolCalls,
        searchPerformed,
        messageHasSearchResults,
        searchMetadata
      });

      return {
        success: true,
        message: result.finalOutput,
        toolCalls: extractedToolCalls || [],
        metadata: {
          search_performed: messageHasSearchResults,
          ...searchMetadata
        }
      };
    } catch (error) {
      console.error('Error in RAG agent chat:', error);
      return {
        success: false,
        message: "I'm sorry, I encountered an error while processing your request. Please try again.",
        error: error.message
      };
    }
  }

  // Extract tool calls from OpenAI Agents SDK RunResult structure
  extractToolCallsFromResult(result) {
    try {
      const toolCalls = [];
      
      console.log('DEBUG: newItems structure:', result.newItems);
      console.log('DEBUG: newItems length:', result.newItems?.length);
      
      // Use the newItems property which contains RunToolCallItem objects
      if (result.newItems) {
        for (let i = 0; i < result.newItems.length; i++) {
          const item = result.newItems[i];
          console.log(`DEBUG: Item ${i}:`, {
            type: item.type,
            rawItem: item.rawItem,
            allProperties: Object.keys(item)
          });
          
          // Look for RunToolCallItem which indicates the LLM invoked a tool
          if (item.type === 'tool_call_item') {
            console.log('DEBUG: Found tool_call_item:', item);
            const toolCall = item.rawItem;
            if (toolCall) {
              // Parse arguments if they're a string
              let parsedArguments = toolCall.arguments;
              if (typeof parsedArguments === 'string') {
                try {
                  parsedArguments = JSON.parse(parsedArguments);
                } catch (e) {
                  console.error('Error parsing tool arguments:', e);
                }
              }
              
              toolCalls.push({
                name: toolCall.name,
                arguments: parsedArguments
              });
            }
          }
        }
      }
      
      console.log('Extracted tool calls from newItems:', toolCalls);
      return toolCalls.length > 0 ? toolCalls : null;
    } catch (error) {
      console.error('Error extracting tool calls from result:', error);
      return null;
    }
  }

  // Extract search metadata from tool calls
  extractSearchMetadata(toolCalls, userMessage) {
    if (!toolCalls || toolCalls.length === 0) {
      return {};
    }

    const metadata = {};
    
    // Find search rental tool calls
    const searchCalls = toolCalls.filter(call => call.name === 'searchRentals');
    if (searchCalls.length > 0) {
      const lastSearch = searchCalls[searchCalls.length - 1];
      metadata.search_type = 'rental_search';
      metadata.search_query = lastSearch.arguments?.query || userMessage;
      metadata.search_filters = lastSearch.arguments?.filters || {};
      metadata.search_limit = lastSearch.arguments?.limit || 5;
      
      // Extract rental IDs from the search results in the final output
      // The handleSearchRentals returns JSON with results array containing id field
      try {
        if (this.lastSearchResults) {
          metadata.rental_ids = this.lastSearchResults.map(rental => rental._id);
          console.log('Extracted rental IDs for UI:', metadata.rental_ids);
        }
      } catch (error) {
        console.error('Error extracting rental IDs:', error);
      }
    }

    // Find property details tool calls
    const detailsCalls = toolCalls.filter(call => call.name === 'getPropertyDetails');
    if (detailsCalls.length > 0) {
      metadata.property_details_requested = true;
      metadata.property_ids = detailsCalls.map(call => call.arguments?.propertyId);
    }

    return metadata;
  }

  async streamChat(userMessage, conversationHistory = []) {
    try {
      const messages = [
        ...conversationHistory,
        { role: "user", content: userMessage }
      ];

      console.log('RAG Agent streaming message:', userMessage);
      
      // Use the standalone run function with streaming enabled
      const stream = await run(this.agent, userMessage, {
        messages: messages,
        stream: true
      });

      return stream;
    } catch (error) {
      console.error('Error in RAG agent stream:', error);
      throw error;
    }
  }
}

export const rentalRAGAgent = new RentalRAGAgent();