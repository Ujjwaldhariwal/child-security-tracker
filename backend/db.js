const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'locations.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache + persistent file sync
let store = {
  devices: {}, // deviceId -> { lastSeen, batteryPct, isCharging, lastLat, lastLng, lastAccuracy }
  locations: [] // array of all location records
};

// Load existing data if file exists
function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      store = JSON.parse(data);
      if (!store.devices) store.devices = {};
      if (!store.locations) store.locations = [];
      console.log(`[DB] Loaded ${store.locations.length} location records for ${Object.keys(store.devices).length} device(s).`);
    } catch (err) {
      console.error('[DB] Error loading database file, initializing empty store:', err.message);
    }
  } else {
    persistDatabase();
  }
}

// Atomic file write to avoid corruption
function persistDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Failed to persist data to disk:', err.message);
  }
}

function saveLocation(record) {
  const { deviceId, timestamp, latitude, longitude, accuracy, batteryPct, isCharging, networkType } = record;
  const entry = {
    id: `loc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    deviceId: deviceId || 'unknown_device',
    timestamp: Number(timestamp) || Date.now(),
    serverReceivedAt: Date.now(),
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: Number(accuracy) || 0,
    batteryPct: Number(batteryPct) || 0,
    isCharging: Boolean(isCharging),
    networkType: networkType || 'UNKNOWN'
  };

  store.locations.push(entry);

  // Keep last 1000 records in memory/disk to keep memory ultra-low
  if (store.locations.length > 1000) {
    store.locations = store.locations.slice(-1000);
  }

  // Update device profile
  store.devices[entry.deviceId] = {
    deviceId: entry.deviceId,
    lastSeen: entry.serverReceivedAt,
    lastReportedTime: entry.timestamp,
    batteryPct: entry.batteryPct,
    isCharging: entry.isCharging,
    latitude: entry.latitude,
    longitude: entry.longitude,
    accuracy: entry.accuracy
  };

  persistDatabase();
  return entry;
}

function getLatestLocation(deviceId) {
  if (deviceId) {
    const dev = store.devices[deviceId];
    if (!dev) return null;
    const history = store.locations.filter(l => l.deviceId === deviceId);
    return history.length ? history[history.length - 1] : null;
  }
  // If no deviceId specified, return latest across all devices
  return store.locations.length ? store.locations[store.locations.length - 1] : null;
}

function getLocationHistory(deviceId, limit = 50) {
  const maxLimit = Math.min(Math.max(1, parseInt(limit) || 50), 200);
  let records = store.locations;
  if (deviceId) {
    records = records.filter(l => l.deviceId === deviceId);
  }
  return records.slice(-maxLimit);
}

function getDevices() {
  return Object.values(store.devices);
}

loadDatabase();

module.exports = {
  saveLocation,
  getLatestLocation,
  getLocationHistory,
  getDevices
};
