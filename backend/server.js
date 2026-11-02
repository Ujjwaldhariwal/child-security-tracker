const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { sendTelegramAlert } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 5050;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'family_secret_token_123';

// Middlewares
app.use(cors());
app.use(express.json());
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

// Authentication middleware for child write operations
function authenticateDevice(req, res, next) {
  const token = req.headers['x-device-token'] || req.query.token;
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or missing X-Device-Token header.'
    });
  }
  next();
}

// Ingestion endpoint (called by child phone)
app.post('/api/location', authenticateDevice, async (req, res) => {
  const { deviceId, latitude, longitude, accuracy, batteryPct, isCharging, networkType, timestamp } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid latitude/longitude.'
    });
  }

  const record = db.saveLocation({
    deviceId: deviceId || 'child_phone_01',
    timestamp: timestamp || Date.now(),
    latitude,
    longitude,
    accuracy: accuracy || 0,
    batteryPct: batteryPct ?? -1,
    isCharging: isCharging ?? false,
    networkType: networkType || 'UNKNOWN'
  });

  // Optional asynchronous Telegram dispatch
  sendTelegramAlert(record).catch(err => console.error('[Alert Error]', err));

  return res.status(201).json({
    success: true,
    message: 'Location recorded successfully.',
    serverTime: Date.now(),
    recordId: record.id
  });
});

// Latest location endpoint (called by parent dashboard)
app.get('/api/location/latest', (req, res) => {
  const { deviceId } = req.query;
  const latest = db.getLatestLocation(deviceId);

  if (!latest) {
    return res.status(404).json({
      success: false,
      message: 'No location records found yet.'
    });
  }

  const timeDiffMinutes = Math.round((Date.now() - latest.timestamp) / 60000);

  return res.json({
    success: true,
    data: {
      ...latest,
      minutesAgo: timeDiffMinutes
    }
  });
});

// Historical coordinates for breadcrumb trail
app.get('/api/location/history', (req, res) => {
  const { deviceId, limit } = req.query;
  const history = db.getLocationHistory(deviceId, limit);
  return res.json({
    success: true,
    count: history.length,
    data: history
  });
});

// Enrolled devices
app.get('/api/devices', (req, res) => {
  const devices = db.getDevices();
  return res.json({
    success: true,
    data: devices
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: Date.now()
  });
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` Family Safety Relay Backend is RUNNING`);
  console.log(` Listening on: http://0.0.0.0:${PORT}`);
  console.log(` Default Auth Token: ${AUTH_TOKEN}`);
  console.log(` Parent Dashboard: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
