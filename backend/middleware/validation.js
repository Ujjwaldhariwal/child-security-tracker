const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PAST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEVICE_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

/**
 * Strict numeric check that forbids booleans, arrays, objects, empty strings,
 * and non-finite numbers (NaN, Infinity).
 */
function isStrictNumeric(val) {
  if (val === undefined || val === null) return false;
  if (typeof val === 'boolean') return false;
  if (typeof val === 'object') return false; // Catches arrays and plain objects
  if (typeof val === 'string' && val.trim() === '') return false;
  const num = Number(val);
  return Number.isFinite(num);
}

/**
 * Validates a single location record.
 * Returns { valid: boolean, error?: string, sanitized?: object }
 */
function validateLocationItem(data, fallbackDeviceId = null, index = null) {
  const prefix = index !== null ? `Item [${index}]: ` : '';

  if (!data || typeof data !== 'object') {
    return { valid: false, error: `${prefix}Payload must be a JSON object.` };
  }

  const deviceId = data.deviceId || fallbackDeviceId || 'child_phone_01';
  if (typeof deviceId !== 'string' || !DEVICE_ID_REGEX.test(deviceId)) {
    return {
      valid: false,
      error: `${prefix}Invalid or missing deviceId format. Must be alphanumeric (1-64 chars).`
    };
  }

  // 1. Latitude validation: must be strictly numeric, finite and within [-90, 90]
  if (!isStrictNumeric(data.latitude)) {
    return { valid: false, error: `${prefix}Invalid or missing latitude: must be a finite number between -90.0 and 90.0.` };
  }
  const lat = Number(data.latitude);
  if (lat < -90.0 || lat > 90.0) {
    return {
      valid: false,
      error: `${prefix}Invalid latitude: must be a finite number between -90.0 and 90.0.`
    };
  }

  // 2. Longitude validation: must be strictly numeric, finite and within [-180, 180]
  if (!isStrictNumeric(data.longitude)) {
    return { valid: false, error: `${prefix}Invalid or missing longitude: must be a finite number between -180.0 and 180.0.` };
  }
  const lng = Number(data.longitude);
  if (lng < -180.0 || lng > 180.0) {
    return {
      valid: false,
      error: `${prefix}Invalid longitude: must be a finite number between -180.0 and 180.0.`
    };
  }

  // 3. Timestamp validation: must be finite, not future (> now + 5 mins), not older than 30 days
  const now = Date.now();
  let ts = now;
  if (data.timestamp !== undefined && data.timestamp !== null) {
    if (!isStrictNumeric(data.timestamp)) {
      return { valid: false, error: `${prefix}Invalid timestamp: must be a finite numeric epoch millisecond.` };
    }
    ts = Number(data.timestamp);
    if (ts > now + MAX_FUTURE_DRIFT_MS) {
      return {
        valid: false,
        error: `${prefix}Future timestamp rejected: timestamp exceeds current time by more than 5 minutes.`
      };
    }
    if (ts < now - MAX_PAST_WINDOW_MS) {
      return {
        valid: false,
        error: `${prefix}Expired timestamp rejected: timestamp is older than 30-day retention window.`
      };
    }
  }

  // Optional fixTimestamp
  let fixTs = ts;
  if (data.fixTimestamp !== undefined && data.fixTimestamp !== null) {
    if (!isStrictNumeric(data.fixTimestamp)) {
      return {
        valid: false,
        error: `${prefix}Invalid fixTimestamp: must be finite and not in the future.`
      };
    }
    fixTs = Number(data.fixTimestamp);
    if (fixTs > now + MAX_FUTURE_DRIFT_MS) {
      return {
        valid: false,
        error: `${prefix}Invalid fixTimestamp: must be finite and not in the future.`
      };
    }
  }

  // 4. Accuracy validation: must be finite and non-negative
  let accuracy = 0;
  if (data.accuracy !== undefined && data.accuracy !== null) {
    if (!isStrictNumeric(data.accuracy)) {
      return {
        valid: false,
        error: `${prefix}Invalid accuracy: must be a non-negative finite number.`
      };
    }
    accuracy = Number(data.accuracy);
    if (accuracy < 0 || accuracy > 100000) {
      return {
        valid: false,
        error: `${prefix}Invalid accuracy: must be a non-negative finite number.`
      };
    }
  }

  // 5. Battery validation: integer between -1 and 100
  let batteryPct = -1;
  if (data.batteryPct !== undefined && data.batteryPct !== null) {
    if (!isStrictNumeric(data.batteryPct)) {
      return {
        valid: false,
        error: `${prefix}Invalid batteryPct: must be an integer between 0 and 100, or -1 if unknown.`
      };
    }
    batteryPct = Number(data.batteryPct);
    if (!Number.isInteger(batteryPct) || batteryPct < -1 || batteryPct > 100) {
      return {
        valid: false,
        error: `${prefix}Invalid batteryPct: must be an integer between 0 and 100, or -1 if unknown.`
      };
    }
  }

  const sanitized = {
    uuid: typeof data.uuid === 'string' && data.uuid.length < 128 ? data.uuid : null,
    deviceId,
    timestamp: ts,
    fixTimestamp: fixTs,
    latitude: lat,
    longitude: lng,
    accuracy,
    batteryPct,
    isCharging: Boolean(data.isCharging),
    isCached: Boolean(data.isCached),
    isOfflineBuffered: Boolean(data.isOfflineBuffered),
    isStale: Boolean(data.isStale),
    networkType: typeof data.networkType === 'string' ? data.networkType.slice(0, 32) : 'UNKNOWN'
  };

  return { valid: true, sanitized };
}

/**
 * Middleware for validating single POST /api/location payloads.
 */
function validateLocation(req, res, next) {
  const result = validateLocationItem(req.body);
  if (!result.valid) {
    return res.status(400).json({
      success: false,
      message: result.error
    });
  }
  req.sanitizedLocation = result.sanitized;
  next();
}

/**
 * Middleware for validating batch POST /api/location/batch payloads.
 */
function validateBatchLocation(req, res, next) {
  const { locations, deviceId: batchDeviceId } = req.body || {};

  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Batch payload must contain a non-empty "locations" array.'
    });
  }

  if (locations.length > 500) {
    return res.status(400).json({
      success: false,
      message: 'Batch size exceeds maximum limit of 500 items per request.'
    });
  }

  const sanitizedBatch = [];
  for (let i = 0; i < locations.length; i++) {
    const item = locations[i];
    // Mark batch ingested items as offline buffered if not already specified
    if (item.isOfflineBuffered === undefined) {
      item.isOfflineBuffered = true;
    }
    const result = validateLocationItem(item, batchDeviceId, i);
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.error,
        failedIndex: i
      });
    }
    sanitizedBatch.push(result.sanitized);
  }

  req.sanitizedBatch = sanitizedBatch;
  next();
}

/**
 * Middleware for validating GET /api/location/history query parameters.
 */
function validateHistoryQuery(req, res, next) {
  const { startTime, endTime, limit, deviceId } = req.query;

  let parsedStartTime = null;
  let parsedEndTime = null;
  let parsedLimit = 50;

  if (deviceId !== undefined && (typeof deviceId !== 'string' || !DEVICE_ID_REGEX.test(deviceId))) {
    return res.status(400).json({
      success: false,
      message: 'Invalid deviceId parameter format.'
    });
  }

  if (startTime !== undefined) {
    if (!isStrictNumeric(startTime)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid startTime parameter: must be a positive finite epoch timestamp.'
      });
    }
    parsedStartTime = Number(startTime);
    if (parsedStartTime < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid startTime parameter: must be a positive finite epoch timestamp.'
      });
    }
  }

  if (endTime !== undefined) {
    if (!isStrictNumeric(endTime)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid endTime parameter: must be a positive finite epoch timestamp.'
      });
    }
    parsedEndTime = Number(endTime);
    if (parsedEndTime < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid endTime parameter: must be a positive finite epoch timestamp.'
      });
    }
  }

  if (parsedStartTime !== null && parsedEndTime !== null && parsedStartTime > parsedEndTime) {
    return res.status(400).json({
      success: false,
      message: 'Invalid range: startTime must be less than or equal to endTime.'
    });
  }

  if (limit !== undefined) {
    if (!isStrictNumeric(limit)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid limit parameter: must be a positive integer.'
      });
    }
    parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid limit parameter: must be a positive integer.'
      });
    }
  }

  req.sanitizedQuery = {
    deviceId: deviceId || null,
    startTime: parsedStartTime,
    endTime: parsedEndTime,
    limit: Math.min(parsedLimit, 2000)
  };

  next();
}

module.exports = {
  validateLocation,
  validateBatchLocation,
  validateHistoryQuery,
  validateLocationItem
};
