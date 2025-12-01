import { CONFIG } from "../config.js";

// Rate limiting map: userId -> timestamp of last quiz start
const rateLimitMap = new Map();

/**
 * Check rate limit for user
 */
export function checkRateLimit(userId) {
  if (!CONFIG.RATE_LIMIT.ENABLED) return { allowed: true };

  const lastStart = rateLimitMap.get(userId);
  const now = Date.now();

  if (lastStart) {
    const timeSince = now - lastStart;
    if (timeSince < CONFIG.RATE_LIMIT.QUIZ_START_COOLDOWN_MS) {
      const remaining = Math.ceil(
        (CONFIG.RATE_LIMIT.QUIZ_START_COOLDOWN_MS - timeSince) / 1000
      );
      return {
        allowed: false,
        message: `⏳ Please wait ${remaining} seconds before starting another quiz.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Update rate limit for user
 */
export function updateRateLimit(userId) {
  rateLimitMap.set(userId, Date.now());

  // Clean up old entries (older than 1 hour)
  if (rateLimitMap.size > 1000) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, timestamp] of rateLimitMap.entries()) {
      if (timestamp < cutoff) {
        rateLimitMap.delete(id);
      }
    }
  }
}
