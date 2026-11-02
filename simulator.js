/**
 * Location Simulator for Family Safety Tracker
 * Simulates real-world movement and supports offline batch reconnect sync.
 *
 * Usage:
 *   node simulator.js          (Live periodic ping simulator)
 *   node simulator.js --batch  (Simulate offline reconnect batch upload)
 */

const http = require('http');

const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const SERVER_PORT = process.env.SERVER_PORT || 5050;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'family_secret_token_123';
const DEVICE_ID = process.env.DEVICE_ID || 'child_phone_01';
const IS_BATCH_MODE = process.argv.includes('--batch');

// Base coordinates (e.g. city center / school)
let lat = 28.6139;
let lng = 77.2090;
let battery = 92;
let step = 0;

console.log('========================================================');
console.log('🚀 Family Safety Device Telemetry Simulator');
console.log(` Target Server: http://${SERVER_HOST}:${SERVER_PORT}`);
console.log(` Device ID:     ${DEVICE_ID}`);
console.log(` Mode:          ${IS_BATCH_MODE ? '📦 Offline Reconnect Batch Upload' : '📡 Live Periodic Tracking (Every 5s)'}`);
console.log('========================================================\n');

if (IS_BATCH_MODE) {
  sendBatchUpload();
} else {
  sendSingleUpdate();
  setInterval(sendSingleUpdate, 5000);
}

function sendSingleUpdate() {
  step++;
  // Simulate natural wandering / transit route
  lat += (Math.random() - 0.48) * 0.0008;
  lng += (Math.random() - 0.48) * 0.0008;
  if (step % 5 === 0 && battery > 10) battery -= 1;

  // Occasional low accuracy to test coarse banner (every 7th step)
  const isCoarse = step % 7 === 0;
  const accuracy = isCoarse ? 150 + Math.round(Math.random() * 50) : Math.round(10 + Math.random() * 12);

  const payload = {
    deviceId: DEVICE_ID,
    timestamp: Date.now(),
    latitude: lat,
    longitude: lng,
    accuracy,
    batteryPct: battery,
    isCharging: false,
    networkType: isCoarse ? 'CELLULAR_COARSE' : 'WIFI'
  };

  const postData = JSON.stringify(payload);

  const req = http.request({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/location',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'X-Device-Token': AUTH_TOKEN
    }
  }, (res) => {
    let responseBody = '';
    res.on('data', chunk => responseBody += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[Step ${step}] ✓ Sent: lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)} | Battery=${battery}% | Acc=±${payload.accuracy}m ${isCoarse ? '⚠️(Coarse)' : ''}`);
      } else {
        console.error(`[Step ${step}] ✗ Error (${res.statusCode}): ${responseBody}`);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`[Step ${step}] ✗ Connection failed: ${err.message}`);
  });

  req.write(postData);
  req.end();
}

function sendBatchUpload() {
  const batchLocations = [];
  const now = Date.now();

  console.log('Simulating 5 location points accumulated during subway transit (offline)...');
  for (let i = 4; i >= 0; i--) {
    lat += 0.0012;
    lng += 0.0009;
    batchLocations.push({
      uuid: `sim-uuid-${now}-${i}`,
      timestamp: now - (i * 300000), // Every 5 minutes in the past
      latitude: lat,
      longitude: lng,
      accuracy: 18.0 + (i * 2),
      batteryPct: battery - i,
      isCharging: false,
      isOfflineBuffered: true,
      networkType: 'OFFLINE_QUEUED'
    });
  }

  const payload = {
    deviceId: DEVICE_ID,
    batchSize: batchLocations.length,
    sentAt: now,
    locations: batchLocations
  };

  const postData = JSON.stringify(payload);

  const req = http.request({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/location/batch',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'X-Device-Token': AUTH_TOKEN
    }
  }, (res) => {
    let responseBody = '';
    res.on('data', chunk => responseBody += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`✓ Batch Upload Successful (${res.statusCode}): Ingested ${batchLocations.length} buffered points.`);
        console.log(`Response: ${responseBody}`);
        process.exit(0);
      } else {
        console.error(`✗ Batch Upload Failed (${res.statusCode}): ${responseBody}`);
        process.exit(1);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`✗ Connection failed: ${err.message}`);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}
