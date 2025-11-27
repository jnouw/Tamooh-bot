/**
 * Input sanitization and validation utilities
 */

/**
 * Sanitize chapter name to prevent injection
 */
export function sanitizeChapterName(chapter) {
  if (!chapter || typeof chapter !== 'string') return null;
  
  // Remove any path separators and special characters
  return chapter
    .trim()
    .replace(/[\/\\.\0]/g, '')
    .substring(0, 50);
}

/**
 * Sanitize code input for Java
 */
export function sanitizeJavaCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Invalid code input' };
  }

  // Check for null bytes
  if (code.includes('\0')) {
    return { valid: false, error: 'Code contains null bytes' };
  }

  // Check for control characters (except tab, newline, carriage return)
  const controlChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/;
  if (controlChars.test(code)) {
    return { valid: false, error: 'Code contains invalid control characters' };
  }

  // Check for overly long lines (potential DoS)
  const lines = code.split('\n');
  const maxLineLength = 500;
  for (const line of lines) {
    if (line.length > maxLineLength) {
      return { valid: false, error: `Line too long (max ${maxLineLength} characters per line)` };
    }
  }

  // Check for excessive nesting (basic heuristic)
  const maxBraceDepth = 10;
  let depth = 0;
  let maxDepth = 0;
  for (const char of code) {
    if (char === '{') {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (char === '}') {
      depth--;
    }
  }
  
  if (maxDepth > maxBraceDepth) {
    return { valid: false, error: 'Code has excessive nesting' };
  }

  return { valid: true, sanitized: code };
}

/**
 * Validate and sanitize user ID
 */
export function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') return false;
  // Discord user IDs are 17-20 digits
  return /^\d{17,20}$/.test(userId);
}

/**
 * Validate and sanitize guild ID
 */
export function validateGuildId(guildId) {
  if (!guildId || typeof guildId !== 'string') return false;
  // Discord guild IDs are 17-20 digits
  return /^\d{17,20}$/.test(guildId);
}

/**
 * Sanitize user input for display
 */
export function sanitizeForDisplay(input, maxLength = 200) {
  if (typeof input !== 'string') return String(input);
  
  return input
    .substring(0, maxLength)
    .replace(/[<>]/g, '') // Remove potential markdown/embed injection
    .trim();
}

/**
 * Validate mode name
 */
export function validateMode(mode) {
  const validModes = ['mcq', 'finderror', 'output', 'code'];
  return validModes.includes(mode);
}

/**
 * Validate time range
 */
export function validateTimeRange(range) {
  const validRanges = ['7d', '30d', 'all'];
  return validRanges.includes(range);
}

/**
 * Check for suspicious patterns in input
 */
export function detectSuspiciousPatterns(input) {
  if (typeof input !== 'string') return false;

  const suspiciousPatterns = [
    /javascript:/i,           // XSS attempts
    /<script/i,               // Script tags
    /on\w+\s*=/i,            // Event handlers
    /eval\(/i,                // Eval calls
    /Function\(/i,            // Function constructor
    /\$\{/,                   // Template literals (in wrong context)
  ];

  return suspiciousPatterns.some(pattern => pattern.test(input));
}

/**
 * Rate limit check helper
 */
export function createRateLimiter(windowMs, maxRequests) {
  const requests = new Map();

  return {
    check: (key) => {
      const now = Date.now();
      const userRequests = requests.get(key) || [];
      
      // Remove old requests outside the window
      const validRequests = userRequests.filter(time => now - time < windowMs);
      
      if (validRequests.length >= maxRequests) {
        return { 
          allowed: false, 
          resetIn: Math.ceil((validRequests[0] + windowMs - now) / 1000) 
        };
      }

      validRequests.push(now);
      requests.set(key, validRequests);
      
      // Cleanup old entries periodically
      if (requests.size > 10000) {
        for (const [k, times] of requests.entries()) {
          if (times.every(t => now - t > windowMs)) {
            requests.delete(k);
          }
        }
      }

      return { allowed: true };
    },
    
    clear: (key) => {
      requests.delete(key);
    }
  };
}