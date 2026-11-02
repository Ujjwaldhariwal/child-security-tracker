const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { sendTelegramAlert } = require('./telegram');
const { authenticateDevice, createRateLimiter } = require('./middleware/security');
const {
  validateLocation,
  validateBatchLocation,
  validateHistoryQuery
} = require('./middleware/validation');

const app = express();
const PORT = process.env.PORT || 5050;

// Rate limiter: 60 requests per minute per IP without external dependencies
const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Rate limit exceeded: Max 60 requests per minute allowed.'
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

/**
 * Single Location Ping
 * Protected with strict header-only authentication and rate limiting.
 */
app.post(
  '/api/location',
  apiRateLimiter,
  authenticateDevice,
  validateLocation,
  async (req, res) => {
    try {
      const sanitized = req.sanitizedLocation;
      const record = db.saveLocation(sanitized);

      // Asynchronous Telegram notification dispatch (does not block HTTP response)
      sendTelegramAlert(record).catch(err =>
        console.error('[Alert Error] Telegram dispatch failure:', err.message)
      );

      return res.status(201).json({
        success: true,
        message: 'Location recorded successfully.',
        serverTime: Date.now(),
        recordId: record.id
      });
    } catch (err) {
      console.error('[Server Error] Failed to process single location:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error processing location record.'
      });
    }
  }
);

/**
 * Batch Location Upload
 * Ingests array of locations collected while offline, with isOfflineBuffered: true.
 * Protected with strict header-only authentication and rate limiting.
 */
app.post(
  '/api/location/batch',
  apiRateLimiter,
  authenticateDevice,
  validateBatchLocation,
  async (req, res) => {
    try {
      const sanitizedBatch = req.sanitizedBatch;
      const batchResult = db.saveLocationBatch(sanitizedBatch);

      return res.status(201).json({
        success: true,
        message: `Successfully ingested ${batchResult.processedCount} offline location fix(es).`,
        processedCount: batchResult.processedCount,
        acknowledgedUuids: batchResult.acknowledgedUuids,
        serverTime: Date.now()
      });
    } catch (err) {
      console.error('[Server Error] Failed to process batch upload:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error processing batch location upload.'
      });
    }
  }
);

/**
 * Latest Location Endpoint
 * Returns single freshest fix and computed age.
 */
app.get('/api/location/latest', (req, res) => {
  const { deviceId } = req.query;
  const latest = db.getLatestLocation(deviceId);

  if (!latest) {
    return res.status(404).json({
      success: false,
      message: 'No location records found yet.'
    });
  }

  const timeDiffMinutes = Math.max(0, Math.round((Date.now() - latest.timestamp) / 60000));

  return res.json({
    success: true,
    data: {
      ...latest,
      minutesAgo: timeDiffMinutes
    }
  });
});

/**
 * History Filtering Endpoint
 * Supports deviceId, startTime, endTime, and limit.
 */
app.get(
  '/api/location/history',
  validateHistoryQuery,
  (req, res) => {
    const { deviceId, startTime, endTime, limit } = req.sanitizedQuery;
    const history = db.getLocationHistory({ deviceId, startTime, endTime, limit });

    return res.json({
      success: true,
      count: history.length,
      data: history
    });
  }
);

/**
 * Enrolled Devices
 */
app.get('/api/devices', (req, res) => {
  const devices = db.getDevices();
  return res.json({
    success: true,
    data: devices
  });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: Date.now()
  });
});

// Centralized Error Handling Middleware (Payload Too Large, Malformed JSON, etc.)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      message: 'Payload Too Large: Request body exceeds maximum allowed size limit.'
    });
  }
  if (err.status === 400 || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      message: 'Bad Request: Malformed JSON payload.'
    });
  }
  console.error('[Unhandled Server Error]', err);
  return res.status(500).json({
    success: false,
    message: 'Internal server error.'
  });
});

// Start listening
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` Family Safety Relay Backend is RUNNING`);
    console.log(` Listening on: http://0.0.0.0:${PORT}`);
    console.log(` Parent Dashboard: http://localhost:${PORT}`);
    console.log(` Rate Limiting: 60 req/min per IP active`);
    console.log(` Validation: Strict numeric finite & bounds active`);
    console.log(`====================================================`);
  });
}

module.exports = app;
