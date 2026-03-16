// Improved parseOpenAIResponse function with robust error handling
// This will replace the current implementation in services/openai.js

function improvedParseOpenAIResponse(response) {
  try {
    console.log('🔍 Starting OpenAI response parsing...');
    console.log('Raw response length:', response?.length || 0);
    
    if (!response || typeof response !== 'string') {
      throw new Error('Invalid response: not a string or empty');
    }
    
    // Log first and last parts for debugging without exposing full content
    console.log('Response preview (first 200 chars):', response.substring(0, 200));
    console.log('Response preview (last 200 chars):', response.substring(Math.max(0, response.length - 200)));
    
    // Remove markdown code blocks if present
    let cleanedResponse = response.trim();
    
    // More robust markdown removal
    const patterns = [
      /^```json\s*/i,
      /^```\s*/,
      /\s*```$/
    ];
    
    patterns.forEach(pattern => {
      cleanedResponse = cleanedResponse.replace(pattern, '');
    });
    
    cleanedResponse = cleanedResponse.trim();
    
    // Check if response looks like it might be truncated
    const lastChar = cleanedResponse.charAt(cleanedResponse.length - 1);
    if (lastChar !== '}' && lastChar !== ']') {
      console.warn('⚠️ Response may be truncated - does not end with } or ]');
      console.log('Last 50 characters:', cleanedResponse.substring(cleanedResponse.length - 50));
    }
    
    // Try to identify the problematic position mentioned in error
    const errorPosition = 4624; // From the error log
    if (cleanedResponse.length > errorPosition) {
      console.log(`Character at error position ${errorPosition}:`, cleanedResponse.charAt(errorPosition));
      console.log(`Context around position ${errorPosition}:`, 
        cleanedResponse.substring(Math.max(0, errorPosition - 50), errorPosition + 50));
    }
    
    console.log('Attempting to parse cleaned response...');
    return JSON.parse(cleanedResponse);
    
  } catch (parseError) {
    console.error('❌ Primary JSON parsing failed:', parseError.message);
    
    // Enhanced error logging
    console.error('Parse error details:', {
      name: parseError.name,
      message: parseError.message,
      position: parseError.message.match(/position (\d+)/)?.[1] || 'unknown'
    });
    
    // Fallback 1: Try parsing original response
    try {
      console.log('🔄 Attempting fallback: parsing original response...');
      return JSON.parse(response);
    } catch (fallbackError) {
      console.error('❌ Fallback parsing also failed:', fallbackError.message);
    }
    
    // Fallback 2: Try to repair common JSON issues
    try {
      console.log('🔧 Attempting JSON repair...');
      let repairedResponse = response.trim();
      
      // Remove markdown blocks more aggressively
      repairedResponse = repairedResponse.replace(/```json/gi, '').replace(/```/g, '');
      
      // Try to fix common issues:
      // 1. Unescaped quotes in strings
      repairedResponse = repairedResponse.replace(/(?<!\\)"/g, '\\"');
      
      // 2. Ensure proper JSON structure
      if (!repairedResponse.startsWith('{') && !repairedResponse.startsWith('[')) {
        // Look for the first { or [
        const jsonStart = Math.min(
          repairedResponse.indexOf('{'),
          repairedResponse.indexOf('[')
        );
        if (jsonStart > -1) {
          repairedResponse = repairedResponse.substring(jsonStart);
        }
      }
      
      return JSON.parse(repairedResponse);
    } catch (repairError) {
      console.error('❌ JSON repair also failed:', repairError.message);
      
      // Final fallback: Return a structured error with partial data
      console.log('🆘 All parsing attempts failed, creating fallback response...');
      
      const fallbackResponse = {
        error: 'JSON_PARSE_FAILED',
        originalError: parseError.message,
        businessName: 'Unable to parse',
        businessType: 'Unable to parse', 
        targetAudience: 'Unable to parse',
        contentFocus: 'Unable to parse',
        rawResponse: response.substring(0, 1000) + '...' // Truncated for safety
      };
      
      console.log('📦 Returning fallback response structure');
      return fallbackResponse;
    }
  }
}

// Export for testing
console.log('✅ Improved JSON parsing function ready');
console.log('📋 Key improvements:');
console.log('  - Better error logging with position context');
console.log('  - Multiple fallback strategies');
console.log('  - JSON repair attempts');
console.log('  - Structured fallback response');
console.log('  - Truncation detection');