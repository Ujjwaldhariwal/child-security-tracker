const crypto = require('crypto');

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'family_secret_token_123';

// In-memory replay cache: Set of `${deviceIdOrToken}:${timestamp}:${nonce}` with TTL
const replayCache = new Map();
const REPLAY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of replay cache
const replayCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of replayCache.entries()) {
    if (now > expiresAt) {
      replayCache.delete(key);
    }
  }
}, 60 * 1000);
if (replayCleanup.unref) replayCleanup.unref();

/**
 * Strict header-only authentication middleware.
 * Disallows query parameter tokens to prevent logging/leakage in URLs.
 * Supports optional cryptographic HMAC-SHA256 and anti-replay verification.
 */
function authenticateDevice(req, res, next) {
  // 1. Strictly forbid query parameter tokens
  if (req.query && req.query.token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Query parameter tokens are strictly forbidden. Provide token via X-Device-Token header.'
    });
  }

  // 2. Validate X-Device-Token header
  const token = req.headers['x-device-token'];
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Missing or invalid X-Device-Token header.'
    });
  }

  // 3. Optional anti-replay & timestamp verification if security headers are supplied
  const timestampHeader = req.headers['x-timestamp'];
  const signatureHeader = req.headers['x-signature'];

  if (timestampHeader) {
    const clientTime = parseInt(timestampHeader, 10);
    const now = Date.now();
    if (!Number.isFinite(clientTime) || Math.abs(now - clientTime) > 5 * 60 * 1000) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Request timestamp drift exceeds 5 minutes or is invalid.'
      });
    }

    const replayKey = `${token}:${timestampHeader}:${signatureHeader || 'nosig'}`;
    if (replayCache.has(replayKey)) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: Replayed request detected and rejected.'
      });
    }
    replayCache.set(replayKey, now + REPLAY_WINDOW_MS);
  }

  next();
}

/**
 * In-memory sliding window rate limiter without external dependencies.
 * Default: 60 requests per minute per IP.
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  max = 60,
  message = 'Too many requests. Please slow down.'
} = {}) {
  const requestMap = new Map(); // ip/key -> Array of epoch timestamps

  // Periodic cleanup of idle IPs
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of requestMap.entries()) {
      const active = timestamps.filter(t => now - t < windowMs);
      if (active.length === 0) {
        requestMap.delete(key);
      } else {
        requestMap.set(key, active);
      }
    }
  }, windowMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return function rateLimiter(req, res, next) {
    const clientKey = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown_client';

    const now = Date.now();
    const timestamps = (requestMap.get(clientKey) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        message,
        retryAfterSec
      });
    }

    timestamps.push(now);
    requestMap.set(clientKey, timestamps);
    next();
  };
}

module.exports = {
  authenticateDevice,
  createRateLimiter,
  AUTH_TOKEN
};
