/**
 * Comprehensive Stress Testing & Edge Cases Automated Test Suite
 * Family Safety Location Tracking Relay Backend
 *
 * Test Suites:
 * 1. Boundary Tests: Null Island (0, 0), Poles (90, -90), Antimeridian (180, -180), Out-of-bounds
 * 2. Malicious Inputs: Non-numeric strings, array injection, booleans, SQL/NoSQL injection, massive payloads (>1MB)
 * 3. Batch Endpoint: Empty batch (0 items), giant batch (>500 items), max boundary (500 items), invalid item failure
 * 4. High Concurrency Stress Test: 50 concurrent simultaneous POST requests, atomic debounced persistence, JSON integrity check
 * 5. Time-Range Filtering & Chronological Ordering: Historical window filtering, monotonic ordering, invalid range validation
 * 6. Security Edge Cases: Bad tokens, query token leak prevention, anti-replay verification
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = require('./server');
const db = require('./db');

const AUTH_TOKEN = 'family_secret_token_123';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'locations.json');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING RIGOROUS STRESS TESTING & EDGE-CASE TEST SUITE');
  console.log('================================================================\n');

  // Start app on an ephemeral port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`[QA Server] Active on http://127.0.0.1:${port}\n`);

  function request(method, reqPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      let payload = null;
      const reqHeaders = { ...headers };

      if (body !== null) {
        if (typeof body === 'string') {
          payload = body;
        } else {
          payload = JSON.stringify(body);
        }
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: reqPath,
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
            body: parsed,
            rawBody: data
          });
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  let passedTests = 0;
  let failedTests = 0;

  async function testCase(name, fn) {
    try {
      process.stdout.write(`  ▶ ${name}... `);
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err) {
      console.log('❌ FAIL');
      console.error(`    Error: ${err.message}`);
      failedTests++;
    }
  }

  try {
    // =========================================================================
    // SUITE 1: GEOGRAPHIC BOUNDARY TESTS
    // =========================================================================
    console.log('📌 SUITE 1: Geographic Boundary Tests');

    await testCase('Null Island boundary (lat: 0, lng: 0) accepted', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_null_island',
        latitude: 0,
        longitude: 0,
        accuracy: 10
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.1'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
    });

    await testCase('North Pole boundary (lat: 90, lng: 0) accepted', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_north_pole',
        latitude: 90,
        longitude: 0,
        accuracy: 15
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.2'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
    });

    await testCase('South Pole boundary (lat: -90, lng: 0) accepted', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_south_pole',
        latitude: -90,
        longitude: 0,
        accuracy: 15
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.3'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
    });

    await testCase('Positive Antimeridian boundary (lat: 0, lng: 180) accepted', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_antimeridian_pos',
        latitude: 0,
        longitude: 180,
        accuracy: 20
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.4'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
    });

    await testCase('Negative Antimeridian boundary (lat: 0, lng: -180) accepted', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_antimeridian_neg',
        latitude: 0,
        longitude: -180,
        accuracy: 20
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.5'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
    });

    await testCase('Latitude out-of-bounds upper (> 90.0) rejected with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_err_1',
        latitude: 90.0001,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.6'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Latitude out-of-bounds lower (< -90.0) rejected with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_err_2',
        latitude: -90.0001,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.7'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Longitude out-of-bounds upper (> 180.0) rejected with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_err_3',
        latitude: 28.6139,
        longitude: 180.0001
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.8'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /longitude/i);
    });

    await testCase('Longitude out-of-bounds lower (< -180.0) rejected with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'bound_err_4',
        latitude: 28.6139,
        longitude: -180.0001
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.1.9'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /longitude/i);
    });

    // =========================================================================
    // SUITE 2: MALICIOUS INPUT & INJECTION REJECTION TESTS
    // =========================================================================
    console.log('\n📌 SUITE 2: Malicious Input & Injection Rejection Tests');

    await testCase('Rejects non-numeric string for latitude with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_01',
        latitude: 'invalid_string_lat',
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.1'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Rejects non-numeric string for longitude with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_02',
        latitude: 28.6139,
        longitude: 'DROP TABLE users;--'
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.2'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /longitude/i);
    });

    await testCase('Rejects array injection in latitude with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_03',
        latitude: [28.6139],
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.3'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Rejects array injection in longitude with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_04',
        latitude: 28.6139,
        longitude: [77.2090]
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.4'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /longitude/i);
    });

    await testCase('Rejects boolean injection (true/false) in coordinates with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_05',
        latitude: true,
        longitude: false
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.5'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Rejects empty string coordinate injection with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'mal_test_06',
        latitude: '',
        longitude: '   '
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.6'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /latitude/i);
    });

    await testCase('Rejects array injection in deviceId with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: ['child_01', 'admin_bypass'],
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.7'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /deviceId/i);
    });

    await testCase('Rejects NoSQL operator injection in deviceId with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: { $ne: null },
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.8'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /deviceId/i);
    });

    await testCase('Rejects SQL injection tokens in deviceId with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: "child_01'; DROP TABLE locations; --",
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.9'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /deviceId/i);
    });

    await testCase('Rejects XSS script tags in deviceId with 400', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: '<script>alert("pwned")</script>',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.10'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /deviceId/i);
    });

    await testCase('Rejects malformed JSON syntax with 400', async () => {
      const res = await request('POST', '/api/location', '{ "deviceId": "broken_json", latitude: }', {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.11',
        'Content-Type': 'application/json'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /malformed json/i);
    });

    await testCase('Rejects massive payload attack (>1MB) with HTTP 413', async () => {
      const hugePadding = 'A'.repeat(1.2 * 1024 * 1024); // 1.2 MB
      const massiveBody = JSON.stringify({
        deviceId: 'massive_flood',
        latitude: 28.6139,
        longitude: 77.2090,
        junk: hugePadding
      });

      const res = await request('POST', '/api/location', massiveBody, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.2.12',
        'Content-Type': 'application/json'
      });
      assert.strictEqual(res.statusCode, 413);
      assert.strictEqual(res.body.success, false);
      assert.match(res.body.message, /Payload Too Large/i);
    });

    // =========================================================================
    // SUITE 3: BATCH UPLOAD EDGE CASES
    // =========================================================================
    console.log('\n📌 SUITE 3: Batch Upload Edge Cases');

    await testCase('Rejects empty batch (0 items) with 400', async () => {
      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_child_01',
        locations: []
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.1'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /non-empty "locations" array/i);
    });

    await testCase('Rejects batch with missing locations field with 400', async () => {
      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_child_01'
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.2'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /non-empty "locations" array/i);
    });

    await testCase('Rejects non-array locations type with 400', async () => {
      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_child_01',
        locations: 'string_instead_of_array'
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.3'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /non-empty "locations" array/i);
    });

    await testCase('Rejects giant batch (> 500 items, e.g. 501) with 400', async () => {
      const oversizedLocations = [];
      const now = Date.now();
      for (let i = 0; i < 501; i++) {
        oversizedLocations.push({
          uuid: `uuid-oversize-${i}`,
          latitude: 28.6 + i * 0.0001,
          longitude: 77.2 + i * 0.0001,
          timestamp: now - (501 - i) * 1000
        });
      }

      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_giant_dev',
        locations: oversizedLocations
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.4'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /exceeds maximum limit of 500 items/i);
    });

    await testCase('Accepts maximum allowed batch boundary (exactly 500 items) with 201', async () => {
      const maxBatch = [];
      const now = Date.now();
      for (let i = 0; i < 500; i++) {
        maxBatch.push({
          uuid: `uuid-max500-${now}-${i}`,
          latitude: 28.6000 + (i * 0.0001),
          longitude: 77.2000 + (i * 0.0001),
          timestamp: now - (500 - i) * 1000,
          accuracy: 10
        });
      }

      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_max_dev',
        locations: maxBatch
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.5'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.processedCount, 500);
      assert.strictEqual(res.body.acknowledgedUuids.length, 500);
    });

    await testCase('Rejects batch with one malformed item and pinpoints failedIndex', async () => {
      const batchWithBadItem = [
        { uuid: 'u-valid-1', latitude: 28.61, longitude: 77.21 },
        { uuid: 'u-valid-2', latitude: 28.62, longitude: 77.22 },
        { uuid: 'u-bad-3', latitude: 999.0, longitude: 77.23 }, // Bad item at index 2
        { uuid: 'u-valid-4', latitude: 28.64, longitude: 77.24 }
      ];

      const res = await request('POST', '/api/location/batch', {
        deviceId: 'batch_item_err',
        locations: batchWithBadItem
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Forwarded-For': '10.10.3.6'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.failedIndex, 2);
      assert.match(res.body.message, /Item \[2\]/i);
    });

    // =========================================================================
    // SUITE 4: HIGH CONCURRENCY STRESS TEST (50 CONCURRENT REQUESTS)
    // =========================================================================
    console.log('\n📌 SUITE 4: High Concurrency Stress Test');

    await testCase('Send 50 simultaneous concurrent requests without corrupting storage', async () => {
      const CONCURRENCY_COUNT = 50;
      const baseTime = Date.now();
      const stressDeviceId = `stress_device_${baseTime}`;
      const uniqueUuids = [];

      // Construct 50 concurrent promises
      const concurrentPromises = [];
      for (let i = 0; i < CONCURRENCY_COUNT; i++) {
        const testUuid = `concurrent-uuid-${baseTime}-${i}`;
        uniqueUuids.push(testUuid);

        const promise = request('POST', '/api/location', {
          uuid: testUuid,
          deviceId: stressDeviceId,
          latitude: 28.5000 + (i * 0.001),
          longitude: 77.1000 + (i * 0.001),
          accuracy: 5 + (i % 10),
          batteryPct: 50 + (i % 50),
          isCharging: i % 2 === 0,
          timestamp: baseTime - (CONCURRENCY_COUNT - i) * 1000
        }, {
          'X-Device-Token': AUTH_TOKEN,
          'X-Forwarded-For': `172.16.0.${i + 1}` // Individual client IPs to stress concurrent debouncer
        });

        concurrentPromises.push(promise);
      }

      // Fire all 50 simultaneously
      const responses = await Promise.all(concurrentPromises);

      // Verify every request received 201 Created
      for (let i = 0; i < responses.length; i++) {
        const resp = responses[i];
        assert.strictEqual(resp.statusCode, 201, `Request #${i} returned status ${resp.statusCode}`);
        assert.strictEqual(resp.body.success, true);
      }

      // Flush debouncer to disk
      await db.flushAsync();

      // Read locations.json directly from disk to verify atomic write integrity
      assert(fs.existsSync(DB_FILE), 'Database file must exist on disk');
      const rawDiskContent = fs.readFileSync(DB_FILE, 'utf8');
      
      let parsedDiskStore;
      try {
        parsedDiskStore = JSON.parse(rawDiskContent);
      } catch (parseErr) {
        throw new Error(`Disk corruption detected in locations.json: ${parseErr.message}`);
      }

      assert(Array.isArray(parsedDiskStore.locations), 'locations must be an array');
      assert(typeof parsedDiskStore.devices === 'object', 'devices must be an object');

      // Verify all 50 unique UUIDs were safely persisted to disk
      const persistedUuids = new Set(parsedDiskStore.locations.map(l => l.uuid));
      for (const uuid of uniqueUuids) {
        assert(persistedUuids.has(uuid), `UUID ${uuid} was lost or dropped during concurrency write`);
      }

      // Check device profile consistency
      const devProfile = parsedDiskStore.devices[stressDeviceId];
      assert(devProfile, `Device profile for ${stressDeviceId} must exist in disk store`);
      assert.strictEqual(devProfile.deviceId, stressDeviceId);
    });

    // =========================================================================
    // SUITE 5: TIME-RANGE QUERY VALIDATION & MONOTONIC CHRONOLOGICAL ORDERING
    // =========================================================================
    console.log('\n📌 SUITE 5: Time-Range Query Validation & Monotonic Chronological Ordering');

    const chronDevice = `chrono_dev_${Date.now()}`;
    const tBase = Date.now() - 120000; // 2 minutes ago

    await testCase('Ingest out-of-order historical points', async () => {
      // Send points deliberately shuffled in time
      const timeOffsets = [50000, 20000, 80000, 10000, 100000, 30000, 60000];
      for (let i = 0; i < timeOffsets.length; i++) {
        const pointTime = tBase + timeOffsets[i];
        const res = await request('POST', '/api/location', {
          deviceId: chronDevice,
          latitude: 28.7000 + (i * 0.001),
          longitude: 77.3000 + (i * 0.001),
          timestamp: pointTime
        }, {
          'X-Device-Token': AUTH_TOKEN,
          'X-Forwarded-For': `10.20.1.${i + 1}`
        });
        assert.strictEqual(res.statusCode, 201);
      }
    });

    await testCase('Queries history filtered within time range [tBase + 25000, tBase + 75000]', async () => {
      const start = tBase + 25000;
      const end = tBase + 75000;
      const res = await request(
        'GET',
        `/api/location/history?deviceId=${chronDevice}&startTime=${start}&endTime=${end}&limit=50`
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert(Array.isArray(res.body.data));

      // Should include offsets: 30000, 50000, 60000 (3 points)
      // Should exclude offsets: 10000, 20000 (< start) and 80000, 100000 (> end)
      assert.strictEqual(res.body.data.length, 3);
      for (const item of res.body.data) {
        assert(item.timestamp >= start, `Item timestamp ${item.timestamp} < startTime ${start}`);
        assert(item.timestamp <= end, `Item timestamp ${item.timestamp} > endTime ${end}`);
      }
    });

    await testCase('Enforces strict monotonic chronological ascending ordering', async () => {
      const res = await request(
        'GET',
        `/api/location/history?deviceId=${chronDevice}&limit=100`
      );

      assert.strictEqual(res.statusCode, 200);
      const points = res.body.data;
      assert(points.length >= 7);

      for (let i = 0; i < points.length - 1; i++) {
        assert(
          points[i].timestamp <= points[i + 1].timestamp,
          `Monotonic ordering violated: Index ${i} (${points[i].timestamp}) > Index ${i + 1} (${points[i + 1].timestamp})`
        );
      }
    });

    await testCase('Rejects invalid time range where startTime > endTime with 400', async () => {
      const res = await request(
        'GET',
        `/api/location/history?deviceId=${chronDevice}&startTime=200000&endTime=100000`
      );
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /startTime must be less than or equal to endTime/i);
    });

    await testCase('Rejects non-numeric startTime with 400', async () => {
      const res = await request(
        'GET',
        `/api/location/history?deviceId=${chronDevice}&startTime=yesterday`
      );
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /Invalid startTime parameter/i);
    });

    await testCase('Rejects negative or invalid limit with 400', async () => {
      const res = await request(
        'GET',
        `/api/location/history?deviceId=${chronDevice}&limit=-10`
      );
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /Invalid limit parameter/i);
    });

    // =========================================================================
    // SUITE 6: SECURITY EDGE CASES & REPLAY ATTACK PREVENTION
    // =========================================================================
    console.log('\n📌 SUITE 6: Security Edge Cases & Replay Protection');

    await testCase('Rejects forged / invalid X-Device-Token with 401', async () => {
      const res = await request('POST', '/api/location', {
        deviceId: 'hacker_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': 'hacker_malicious_key',
        'X-Forwarded-For': '10.30.1.1'
      });
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.body.message, /Unauthorized/i);
    });

    await testCase('Strictly forbids query token parameter leak with 401', async () => {
      const res = await request('POST', `/api/location?token=${AUTH_TOKEN}`, {
        deviceId: 'url_token_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Forwarded-For': '10.30.1.2'
      });
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.body.message, /Query parameter tokens are strictly forbidden/i);
    });

    await testCase('Anti-replay protection detects and rejects duplicate signature/timestamp with 409', async () => {
      const testTime = Date.now();
      const testSig = 'mock_hmac_signature_abc123';

      // First request with signature headers
      const res1 = await request('POST', '/api/location', {
        deviceId: 'replay_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Timestamp': testTime.toString(),
        'X-Signature': testSig,
        'X-Forwarded-For': '10.30.1.3'
      });
      assert.strictEqual(res1.statusCode, 201);

      // Replayed request with identical signature & timestamp
      const res2 = await request('POST', '/api/location', {
        deviceId: 'replay_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Timestamp': testTime.toString(),
        'X-Signature': testSig,
        'X-Forwarded-For': '10.30.1.3'
      });
      assert.strictEqual(res2.statusCode, 409);
      assert.match(res2.body.message, /Replayed request detected and rejected/i);
    });

    await testCase('Rejects drifted timestamp (> 5 mins) in security headers with 401', async () => {
      const expiredTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago
      const res = await request('POST', '/api/location', {
        deviceId: 'drift_dev',
        latitude: 28.6139,
        longitude: 77.2090
      }, {
        'X-Device-Token': AUTH_TOKEN,
        'X-Timestamp': expiredTime.toString(),
        'X-Signature': 'some_sig',
        'X-Forwarded-For': '10.30.1.4'
      });
      assert.strictEqual(res.statusCode, 401);
      assert.match(res.body.message, /drift exceeds 5 minutes/i);
    });

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n================================================================');
    console.log(`📊 TEST SUITE SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('================================================================');

    if (failedTests > 0) {
      throw new Error(`Test suite failed with ${failedTests} failure(s).`);
    } else {
      console.log('✅ ALL STRESS AND EDGE-CASE TESTS COMPLETED WITH 100% PASS RATE.\n');
    }

  } finally {
    server.close();
  }
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('\n❌ FATAL TEST FAILURE:', err.message);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
