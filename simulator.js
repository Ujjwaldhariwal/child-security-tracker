/**
 * Location Simulator for Family Safety POC
 * Simulates a child phone moving along a realistic route with battery drain.
 * Usage: node simulator.js
 */

const http = require('http');

const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const SERVER_PORT = process.env.SERVER_PORT || 5050;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'family_secret_token_123';
const DEVICE_ID = process.env.DEVICE_ID || 'child_phone_01';

// Base coordinates (e.g. city center)
let lat = 28.6139;
let lng = 77.2090;
let battery = 95;
let step = 0;

console.log('========================================================');
console.log('🚀 Family Safety Device Simulator Started');
console.log(` Target Server: http://${SERVER_HOST}:${SERVER_PORT}`);
console.log(` Device ID:     ${DEVICE_ID}`);
console.log(' Simulating movement updates every 5 seconds for testing...');
console.log('========================================================\n');

function sendUpdate() {
  step++;
  // Simulate natural wandering / walking path
  lat += (Math.random() - 0.48) * 0.0008;
  lng += (Math.random() - 0.48) * 0.0008;
  if (step % 4 === 0 && battery > 10) battery -= 1; // gradual battery decrease

  const payload = {
    deviceId: DEVICE_ID,
    timestamp: Date.now(),
    latitude: lat,
    longitude: lng,
    accuracy: Math.round(10 + Math.random() * 8),
    batteryPct: battery,
    isCharging: false,
    networkType: 'WIFI'
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
        console.log(`[Step ${step}] ✓ Sent: lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)} | Battery=${battery}% | Accuracy=±${payload.accuracy}m`);
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

// Send initial ping immediately, then repeat every 5 seconds for interactive testing
sendUpdate();
setInterval(sendUpdate, 5000);
