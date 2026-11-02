const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'locations.json');
const MAX_POINTS_PER_DEVICE = 2000;
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache + persistent file sync
let store = {
  devices: {}, // deviceId -> DeviceState
  locations: [] // Array of LocationRecord (circular buffer)
};

// Async persistence state & debounce handles
let debounceTimer = null;
let isPersisting = false;
let persistQueued = false;

// Remove stale temp files from previous process crashes
function cleanupTempFiles() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file.startsWith('locations.json.tmp.')) {
        try {
          fs.unlinkSync(path.join(DATA_DIR, file));
        } catch (_) {}
      }
    }
  } catch (_) {}
}

// Load existing data if file exists
function loadDatabase() {
  cleanupTempFiles();
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      store = JSON.parse(data);
      if (!store.devices || typeof store.devices !== 'object') store.devices = {};
      if (!Array.isArray(store.locations)) store.locations = [];
      pruneStore();
      console.log(`[DB] Loaded ${store.locations.length} location records for ${Object.keys(store.devices).length} device(s).`);
    } catch (err) {
      console.error('[DB] Error loading database file, initializing empty store:', err.message);
      store = { devices: {}, locations: [] };
    }
  } else {
    persistDatabaseSync();
  }
}

/**
 * Synchronous atomic file write fallback (used on startup or process exit).
 */
function persistDatabaseSync() {
  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 5)}`;
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Synchronous persist failed:', err.message);
  }
}

/**
 * Non-blocking asynchronous atomic persistence.
 */
async function persistDatabaseAsync() {
  if (isPersisting) {
    persistQueued = true;
    return;
  }
  isPersisting = true;

  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 5)}`;
    const serialized = JSON.stringify(store, null, 2);
    await fs.promises.writeFile(tempFile, serialized, 'utf8');
    await fs.promises.rename(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Non-blocking atomic persist error:', err.message);
  } finally {
    isPersisting = false;
    if (persistQueued) {
      persistQueued = false;
      setImmediate(() => {
        persistDatabaseAsync().catch(e => console.error('[DB] Queued persist failed:', e));
      });
    }
  }
}

/**
 * Debounced persistence trigger.
 * Coalesces rapid sequential writes into a single atomic disk flush.
 */
function schedulePersist(delayMs = 250) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    persistDatabaseAsync().catch(err => console.error('[DB] Debounced persist failed:', err));
  }, delayMs);
}

/**
 * Dual-Constraint Pruning Policy:
 * 1. TTL: Evicts records older than 30 days.
 * 2. Circular buffer capacity cap: Retains at most 2,000 points per device.
 */
function pruneStore() {
  const now = Date.now();
  const ttlThreshold = now - TTL_MS;

  // Group records by deviceId
  const deviceGroups = new Map();
  for (const loc of store.locations) {
    if (loc.timestamp < ttlThreshold) {
      continue; // Evict expired by TTL
    }
    const dId = loc.deviceId || 'unknown_device';
    if (!deviceGroups.has(dId)) {
      deviceGroups.set(dId, []);
    }
    deviceGroups.get(dId).push(loc);
  }

  const pruned = [];
  for (const [, records] of deviceGroups.entries()) {
    // Sort chronologically ascending
    records.sort((a, b) => a.timestamp - b.timestamp);
    // Circular buffer: keep at most MAX_POINTS_PER_DEVICE (last 2000 points)
    const retained = records.length > MAX_POINTS_PER_DEVICE
      ? records.slice(-MAX_POINTS_PER_DEVICE)
      : records;
    pruned.push(...retained);
  }

  // Final chronological sort
  pruned.sort((a, b) => a.timestamp - b.timestamp);
  store.locations = pruned;
}

/**
 * Update device profile in store.devices based on latest fix.
 */
function updateDeviceProfile(entry) {
  const existing = store.devices[entry.deviceId];
  const isNewer = !existing || entry.timestamp >= (existing.lastReportedTime || 0);

  if (isNewer) {
    store.devices[entry.deviceId] = {
      deviceId: entry.deviceId,
      lastSeen: entry.serverReceivedAt,
      lastReportedTime: entry.timestamp,
      fixTimestamp: entry.fixTimestamp || entry.timestamp,
      batteryPct: entry.batteryPct,
      isCharging: entry.isCharging,
      latitude: entry.latitude,
      longitude: entry.longitude,
      accuracy: entry.accuracy,
      isCached: entry.isCached,
      isOfflineBuffered: entry.isOfflineBuffered,
      isStale: entry.isStale,
      networkType: entry.networkType
    };
  } else if (existing) {
    // Keep lastSeen fresh even if older historical fix was received
    existing.lastSeen = Math.max(existing.lastSeen || 0, entry.serverReceivedAt);
  }
}

/**
 * Saves a single location record.
 */
function saveLocation(record) {
  const entry = {
    id: record.id || `loc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    uuid: record.uuid || null,
    deviceId: record.deviceId || 'child_phone_01',
    timestamp: Number(record.timestamp) || Date.now(),
    fixTimestamp: record.fixTimestamp ? Number(record.fixTimestamp) : (Number(record.timestamp) || Date.now()),
    serverReceivedAt: Date.now(),
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    accuracy: Number(record.accuracy) || 0,
    batteryPct: record.batteryPct !== undefined ? Number(record.batteryPct) : -1,
    isCharging: Boolean(record.isCharging),
    isCached: Boolean(record.isCached),
    isOfflineBuffered: Boolean(record.isOfflineBuffered),
    isStale: Boolean(record.isStale),
    networkType: record.networkType || 'UNKNOWN'
  };

  store.locations.push(entry);
  updateDeviceProfile(entry);
  pruneStore();
  schedulePersist();

  return entry;
}

/**
 * Saves an array of locations in bulk (Batch Ingestion).
 * Avoids duplicate insertion if UUID exists.
 */
function saveLocationBatch(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { processedCount: 0, acknowledgedUuids: [], entries: [] };
  }

  const existingUuids = new Set(
    store.locations.filter(l => l.uuid).map(l => l.uuid)
  );

  const savedEntries = [];
  const acknowledgedUuids = [];

  for (const record of records) {
    // Deduplication check by UUID if supplied
    if (record.uuid && existingUuids.has(record.uuid)) {
      acknowledgedUuids.push(record.uuid);
      continue;
    }

    const entry = {
      id: record.id || `loc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      uuid: record.uuid || null,
      deviceId: record.deviceId || 'child_phone_01',
      timestamp: Number(record.timestamp) || Date.now(),
      fixTimestamp: record.fixTimestamp ? Number(record.fixTimestamp) : (Number(record.timestamp) || Date.now()),
      serverReceivedAt: Date.now(),
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      accuracy: Number(record.accuracy) || 0,
      batteryPct: record.batteryPct !== undefined ? Number(record.batteryPct) : -1,
      isCharging: Boolean(record.isCharging),
      isCached: Boolean(record.isCached),
      isOfflineBuffered: true, // Marked as offline buffered for batch uploads
      isStale: Boolean(record.isStale),
      networkType: record.networkType || 'OFFLINE_QUEUED'
    };

    store.locations.push(entry);
    if (entry.uuid) {
      existingUuids.add(entry.uuid);
      acknowledgedUuids.push(entry.uuid);
    }
    savedEntries.push(entry);
    updateDeviceProfile(entry);
  }

  pruneStore();
  schedulePersist();

  return {
    processedCount: savedEntries.length,
    acknowledgedUuids,
    entries: savedEntries
  };
}

/**
 * Retrieves the latest location fix for a given device or overall.
 */
function getLatestLocation(deviceId) {
  if (deviceId) {
    const dev = store.devices[deviceId];
    if (!dev) return null;
    const history = store.locations.filter(l => l.deviceId === deviceId);
    return history.length ? history[history.length - 1] : null;
  }
  return store.locations.length ? store.locations[store.locations.length - 1] : null;
}

/**
 * Retrieves location history with support for deviceId, startTime, endTime, limit.
 * Supports both object signature ({ deviceId, startTime, endTime, limit })
 * and positional signature (deviceId, limit) for backward compatibility.
 */
function getLocationHistory(optionsOrDeviceId, limitArg) {
  let deviceId = null;
  let startTime = null;
  let endTime = null;
  let limit = 50;

  if (typeof optionsOrDeviceId === 'object' && optionsOrDeviceId !== null) {
    deviceId = optionsOrDeviceId.deviceId || null;
    startTime = optionsOrDeviceId.startTime !== undefined && optionsOrDeviceId.startTime !== null
      ? Number(optionsOrDeviceId.startTime)
      : null;
    endTime = optionsOrDeviceId.endTime !== undefined && optionsOrDeviceId.endTime !== null
      ? Number(optionsOrDeviceId.endTime)
      : null;
    limit = optionsOrDeviceId.limit !== undefined && optionsOrDeviceId.limit !== null
      ? parseInt(optionsOrDeviceId.limit, 10)
      : 50;
  } else {
    deviceId = optionsOrDeviceId || null;
    limit = limitArg !== undefined ? parseInt(limitArg, 10) : 50;
  }

  const maxLimit = Math.min(Math.max(1, limit || 50), 2000);
  let records = store.locations;

  if (deviceId) {
    records = records.filter(l => l.deviceId === deviceId);
  }

  if (Number.isFinite(startTime)) {
    records = records.filter(l => l.timestamp >= startTime);
  }

  if (Number.isFinite(endTime)) {
    records = records.filter(l => l.timestamp <= endTime);
  }

  // Ensure chronological order
  records.sort((a, b) => a.timestamp - b.timestamp);

  return records.slice(-maxLimit);
}

/**
 * Returns all active devices.
 */
function getDevices() {
  return Object.values(store.devices);
}

/**
 * Force flush database immediately (useful for tests or graceful shutdown).
 */
async function flushAsync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await persistDatabaseAsync();
}

// Initial bootstrap
loadDatabase();

// Flush on process exit to avoid lost pending debounced writes
process.on('SIGINT', () => {
  persistDatabaseSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  persistDatabaseSync();
  process.exit(0);
});

module.exports = {
  saveLocation,
  saveLocationBatch,
  getLatestLocation,
  getLocationHistory,
  getDevices,
  flushAsync,
  pruneStore,
  MAX_POINTS_PER_DEVICE,
  TTL_DAYS
};
