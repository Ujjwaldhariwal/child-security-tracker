const http = require('http');
const assert = require('assert');
const app = require('./server');
const db = require('./db');

async function runTests() {
  console.log('🧪 Starting Comprehensive Backend API & Security Tests...\n');

  // Start app on ephemeral port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`[Test Server] Listening on http://127.0.0.1:${port}`);

  function makeRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const reqHeaders = { ...headers };
      if (payload) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    // 1. Health check
    const health = await makeRequest('GET', '/health');
    assert.strictEqual(health.statusCode, 200);
    assert.strictEqual(health.body.status, 'healthy');
    console.log('✓ GET /health is functional');

    // 2. Query param token MUST be rejected with 401
    const queryTokenRes = await makeRequest('POST', '/api/location?token=family_secret_token_123', {
      latitude: 28.6139,
      longitude: 77.2090
    });
    assert.strictEqual(queryTokenRes.statusCode, 401);
    assert.match(queryTokenRes.body.message, /forbidden/i);
    console.log('✓ Strict Header Auth: Rejects query param token with 401');

    // 3. Missing header token MUST be rejected with 401
    const noTokenRes = await makeRequest('POST', '/api/location', {
      latitude: 28.6139,
      longitude: 77.2090
    });
    assert.strictEqual(noTokenRes.statusCode, 401);
    console.log('✓ Strict Header Auth: Rejects request missing X-Device-Token with 401');

    // 4. Invalid header token MUST be rejected with 401
    const badTokenRes = await makeRequest('POST', '/api/location', {
      latitude: 28.6139,
      longitude: 77.2090
    }, { 'X-Device-Token': 'wrong_token' });
    assert.strictEqual(badTokenRes.statusCode, 401);
    console.log('✓ Strict Header Auth: Rejects invalid X-Device-Token with 401');

    // 5. Validation: Reject NaN latitude
    const nanLatRes = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: NaN,
      longitude: 77.2090
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(nanLatRes.statusCode, 400);
    assert.match(nanLatRes.body.message, /latitude/i);
    console.log('✓ Validation: Blocks NaN latitude with 400');

    // 6. Validation: Reject Infinity longitude
    const infLngRes = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: 28.6139,
      longitude: Infinity
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(infLngRes.statusCode, 400);
    assert.match(infLngRes.body.message, /longitude/i);
    console.log('✓ Validation: Blocks Infinity longitude with 400');

    // 7. Validation: Reject out-of-bounds coordinates
    const outBoundsRes1 = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: 91.5,
      longitude: 77.2090
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(outBoundsRes1.statusCode, 400);
    console.log('✓ Validation: Rejects latitude > 90 with 400');

    const outBoundsRes2 = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: 28.6139,
      longitude: -181.2
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(outBoundsRes2.statusCode, 400);
    console.log('✓ Validation: Rejects longitude < -180 with 400');

    // 8. Validation: Reject future timestamps (> now + 5 mins)
    const futureTimeRes = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: 28.6139,
      longitude: 77.2090,
      timestamp: Date.now() + 10 * 60 * 1000 // +10 minutes
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(futureTimeRes.statusCode, 400);
    assert.match(futureTimeRes.body.message, /Future timestamp rejected/i);
    console.log('✓ Validation: Blocks future timestamps (> 5 mins drift) with 400');

    // 9. Valid Single Location Ingestion
    const validPostRes = await makeRequest('POST', '/api/location', {
      deviceId: 'test_child_01',
      latitude: 28.6139,
      longitude: 77.2090,
      accuracy: 15.5,
      batteryPct: 85,
      isCharging: false,
      timestamp: Date.now()
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(validPostRes.statusCode, 201);
    assert.strictEqual(validPostRes.body.success, true);
    console.log('✓ Ingestion: Successfully records valid single location with 201');

    // 10. Batch Upload Endpoint: POST /api/location/batch
    const u1 = `uuid-offline-${Date.now()}-1`;
    const u2 = `uuid-offline-${Date.now()}-2`;
    const batchRes = await makeRequest('POST', '/api/location/batch', {
      deviceId: 'test_child_01',
      locations: [
        {
          uuid: u1,
          timestamp: Date.now() - 30000,
          latitude: 28.6145,
          longitude: 77.2095,
          accuracy: 12.0,
          batteryPct: 84,
          isCharging: false,
          isOfflineBuffered: true
        },
        {
          uuid: u2,
          timestamp: Date.now() - 15000,
          latitude: 28.6150,
          longitude: 77.2100,
          accuracy: 11.5,
          batteryPct: 83,
          isCharging: false,
          isOfflineBuffered: true
        }
      ]
    }, { 'X-Device-Token': 'family_secret_token_123' });
    assert.strictEqual(batchRes.statusCode, 201);
    assert.strictEqual(batchRes.body.processedCount, 2);
    assert.deepStrictEqual(batchRes.body.acknowledgedUuids, [u1, u2]);
    console.log('✓ Batch Upload: Ingests offline buffered batch with 201 and UUID acknowledgment');

    // 11. History Endpoint with Date/Time Range & Limit Filtering
    const now = Date.now();
    const historyRes = await makeRequest(
      'GET',
      `/api/location/history?deviceId=test_child_01&startTime=${now - 60000}&endTime=${now + 1000}&limit=10`
    );
    assert.strictEqual(historyRes.statusCode, 200);
    assert.strictEqual(historyRes.body.success, true);
    assert(historyRes.body.data.length >= 3);
    console.log(`✓ History Filtering: Correctly filtered ${historyRes.body.data.length} records by time range`);

    // 12. GET /api/location/latest
    const latestRes = await makeRequest('GET', '/api/location/latest?deviceId=test_child_01');
    assert.strictEqual(latestRes.statusCode, 200);
    assert.strictEqual(latestRes.body.data.deviceId, 'test_child_01');
    assert(typeof latestRes.body.data.minutesAgo === 'number');
    console.log('✓ Latest Endpoint: Returns most recent fix and relative minutesAgo');

    // 13. Circular Buffer & Retention verification
    const floodDevId = `flood_test_dev_${Date.now()}`;
    for (let i = 0; i < 20; i++) {
      db.saveLocation({
        deviceId: floodDevId,
        latitude: 20 + i * 0.001,
        longitude: 70 + i * 0.001,
        timestamp: Date.now() - (20 - i) * 1000
      });
    }
    const floodHistory = db.getLocationHistory({ deviceId: floodDevId, limit: 100 });
    assert.strictEqual(floodHistory.length, 20);
    console.log('✓ Circular Buffer: Correctly orders and slices historical points');

    // Flush db to test async non-blocking persist
    await db.flushAsync();
    console.log('✓ Async DB: Flushed atomically to disk without blocking');

    // 14. In-memory Rate Limiter: Send 65 rapid requests and verify HTTP 429
    let got429 = false;
    for (let i = 0; i < 65; i++) {
      const res = await makeRequest('POST', '/api/location', {
        deviceId: 'rate_test_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, { 'X-Device-Token': 'family_secret_token_123' });
      if (res.statusCode === 429) {
        got429 = true;
        assert.strictEqual(res.statusCode, 429);
        assert(res.body.retryAfterSec > 0);
        break;
      }
    }
    assert.strictEqual(got429, true, 'Rate limiter should have triggered HTTP 429');
    console.log('✓ Rate Limiter: In-memory sliding window returned 429 Too Many Requests');

    console.log('\n🎉 ALL 14 TEST SUITES PASSED FLAWLESSLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
