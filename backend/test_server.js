const http = require('http');
const assert = require('assert');

// Simple end-to-end integration test for the backend API
async function testBackend() {
  console.log('🧪 Starting Backend API Automated Tests...');

  // 1. Check health
  const healthRes = await makeRequest('GET', '/health');
  assert.strictEqual(healthRes.status, 'healthy');
  console.log('✓ GET /health passed');

  // 2. Test unauthorized POST
  try {
    await makeRequest('POST', '/api/location', { latitude: 37.7749, longitude: -122.4194 }, {});
    assert.fail('Should have failed with 401');
  } catch (err) {
    assert.strictEqual(err.statusCode, 401);
    console.log('✓ POST /api/location rejects unauthorized request with 401');
  }

  // 3. Test authorized POST
  const postRes = await makeRequest('POST', '/api/location', {
    deviceId: 'test_phone_01',
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 14.2,
    batteryPct: 88,
    isCharging: false,
    timestamp: Date.now()
  }, { 'X-Device-Token': 'family_secret_token_123' });
  assert.strictEqual(postRes.success, true);
  console.log('✓ POST /api/location records location with 201');

  // 4. Test GET /api/location/latest
  const latestRes = await makeRequest('GET', '/api/location/latest?deviceId=test_phone_01');
  assert.strictEqual(latestRes.success, true);
  assert.strictEqual(latestRes.data.deviceId, 'test_phone_01');
  assert.strictEqual(latestRes.data.latitude, 37.7749);
  assert.strictEqual(latestRes.data.batteryPct, 88);
  console.log('✓ GET /api/location/latest retrieves correct coordinates & battery');

  // 5. Test GET /api/devices
  const devRes = await makeRequest('GET', '/api/devices');
  assert.strictEqual(devRes.success, true);
  assert(devRes.data.some(d => d.deviceId === 'test_phone_01'));
  console.log('✓ GET /api/devices lists active device');

  console.log('\n🎉 ALL BACKEND API TESTS PASSED SUCCESSFULLY!\n');
}

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: 'localhost',
      port: 5050,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          const err = new Error(`Request failed with status ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

testBackend().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
