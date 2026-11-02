// Leaflet Map State
let map = null;
let currentMarker = null;
let accuracyCircle = null;
let trailPolyline = null;
let waypointLayer = null;

let currentDeviceId = null;
let currentRange = '24h'; // Default range: 24 hours

const DEFAULT_COORDS = [28.6139, 77.2090]; // Default fallback coordinates
const POLL_INTERVAL_MS = 15000; // Poll every 15s

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  fetchLatestLocation();
  fetchLocationTrail();

  // Periodic polling loop
  setInterval(() => {
    fetchLatestLocation();
    if (document.getElementById('chkShowTrail').checked) {
      fetchLocationTrail();
    }
  }, POLL_INTERVAL_MS);
});

function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView(DEFAULT_COORDS, 14);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Standard OpenStreetMap Tile Layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Layer group for interactive clickable waypoint markers
  waypointLayer = L.layerGroup().addTo(map);
}

function setupEventListeners() {
  // Manual refresh button
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      btnRefresh.style.transform = 'rotate(180deg)';
      setTimeout(() => btnRefresh.style.transform = '', 300);
      fetchLatestLocation();
      fetchLocationTrail();
    });
  }

  // Toggle trail & waypoints visibility
  const chkTrail = document.getElementById('chkShowTrail');
  if (chkTrail) {
    chkTrail.addEventListener('change', (e) => {
      if (e.target.checked) {
        fetchLocationTrail();
      } else {
        if (trailPolyline) {
          map.removeLayer(trailPolyline);
          trailPolyline = null;
        }
        if (waypointLayer) {
          waypointLayer.clearLayers();
        }
        document.getElementById('trailCountBadge').textContent = '0 waypoints';
      }
    });
  }

  // Time-range selector buttons ("Past 2 Hours", "Past 24 Hours", "All")
  const filterButtons = document.querySelectorAll('.time-filter-buttons .filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterButtons.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentRange = e.currentTarget.getAttribute('data-range');
      fetchLocationTrail();
    });
  });
}

/**
 * Fetches the latest location fix from the backend
 */
async function fetchLatestLocation() {
  try {
    const url = currentDeviceId ? `/api/location/latest?deviceId=${encodeURIComponent(currentDeviceId)}` : '/api/location/latest';
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        document.getElementById('valLastUpdated').textContent = 'No data yet (Awaiting first fix)';
        document.getElementById('statusIndicator').className = 'status-dot amber';
      }
      return;
    }

    const result = await response.json();
    if (!result.success || !result.data) return;

    currentDeviceId = result.data.deviceId;
    renderLocation(result.data);
  } catch (err) {
    console.error('Failed to fetch latest location:', err);
    document.getElementById('statusIndicator').className = 'status-dot red';
  }
}

/**
 * Updates UI telemetry, warning banners, indicator pills, and map markers
 */
function renderLocation(data) {
  const {
    deviceId,
    latitude,
    longitude,
    accuracy,
    batteryPct,
    isCharging,
    timestamp,
    minutesAgo,
    isOfflineBuffered,
    isCached,
    isStale,
    networkType
  } = data;

  // 1. Device identity & telemetry values
  document.getElementById('deviceTitle').textContent = deviceId;
  document.getElementById('valCoords').textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  document.getElementById('valAccuracy').textContent = `±${Math.round(accuracy)} m`;
  document.getElementById('valNetwork').textContent = networkType || 'Cell/WiFi';

  // 2. Coarse Location Warning Banner: Display if accuracy > 100 meters
  const coarseBanner = document.getElementById('coarseWarningBanner');
  const coarseAccVal = document.getElementById('coarseAccuracyVal');
  if (accuracy > 100) {
    coarseAccVal.textContent = `±${Math.round(accuracy)} m`;
    coarseBanner.classList.remove('hidden');
  } else {
    coarseBanner.classList.add('hidden');
  }

  // 3. Fresh vs Cached / Buffered Indicator Pill
  const pillFixType = document.getElementById('pillFixType');
  if (isOfflineBuffered) {
    pillFixType.textContent = '📦 Offline Buffered';
    pillFixType.className = 'pill-badge pill-buffered';
  } else if (isStale || isCached) {
    pillFixType.textContent = '🕒 Cached Fix (Stale)';
    pillFixType.className = 'pill-badge pill-stale';
  } else {
    pillFixType.textContent = '📡 Live GPS Fix';
    pillFixType.className = 'pill-badge pill-live';
  }

  // 4. Last updated text & status dot
  const timeText = formatMinutesAgo(minutesAgo, timestamp);
  document.getElementById('valLastUpdated').textContent = timeText;

  const statusIndicator = document.getElementById('statusIndicator');
  if (minutesAgo <= 35) {
    statusIndicator.className = 'status-dot green';
  } else if (minutesAgo <= 75) {
    statusIndicator.className = 'status-dot amber';
  } else {
    statusIndicator.className = 'status-dot red';
  }

  // 5. Battery indicator
  const batteryBadge = document.getElementById('batteryBadge');
  const batteryText = document.getElementById('batteryText');
  if (batteryPct >= 0) {
    batteryText.textContent = `${batteryPct}%${isCharging ? ' ⚡' : ''}`;
    if (batteryPct > 50) batteryBadge.style.color = '#10b981';
    else if (batteryPct > 20) batteryBadge.style.color = '#f59e0b';
    else batteryBadge.style.color = '#ef4444';
  } else {
    batteryText.textContent = '--%';
  }

  // 6. External Maps Link
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  document.getElementById('btnExternalMaps').href = mapsUrl;

  // 7. Update Map Marker
  const latLng = [latitude, longitude];

  if (!currentMarker) {
    const customIcon = L.divIcon({
      className: 'custom-pin',
      html: `<div style="
        width: 18px;
        height: 18px;
        background: #1e3a8a;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    currentMarker = L.marker(latLng, { icon: customIcon }).addTo(map);
    map.setView(latLng, 15);
  } else {
    currentMarker.setLatLng(latLng);
  }

  // 8. Update Accuracy Circle (visual radius)
  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: Math.max(accuracy, 15),
      color: accuracy > 100 ? '#f59e0b' : '#3b82f6',
      fillColor: accuracy > 100 ? '#fde68a' : '#93c5fd',
      fillOpacity: 0.25,
      weight: 1
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(Math.max(accuracy, 15));
    accuracyCircle.setStyle({
      color: accuracy > 100 ? '#f59e0b' : '#3b82f6',
      fillColor: accuracy > 100 ? '#fde68a' : '#93c5fd'
    });
  }
}

/**
 * Fetches location trail based on selected time range
 * and renders polyline + interactive clickable waypoint markers.
 */
async function fetchLocationTrail() {
  const chkTrail = document.getElementById('chkShowTrail');
  if (chkTrail && !chkTrail.checked) return;

  try {
    let url = '/api/location/history?limit=500';
    if (currentDeviceId) {
      url += `&deviceId=${encodeURIComponent(currentDeviceId)}`;
    }

    const now = Date.now();
    if (currentRange === '2h') {
      const startTime = now - (2 * 60 * 60 * 1000);
      url += `&startTime=${startTime}`;
    } else if (currentRange === '24h') {
      const startTime = now - (24 * 60 * 60 * 1000);
      url += `&startTime=${startTime}`;
    }

    const response = await fetch(url);
    if (!response.ok) return;

    const result = await response.json();
    if (!result.success || !Array.isArray(result.data)) return;

    const waypoints = result.data;
    document.getElementById('trailCountBadge').textContent = `${waypoints.length} waypoint${waypoints.length === 1 ? '' : 's'}`;

    // Clear previous waypoint markers
    if (waypointLayer) {
      waypointLayer.clearLayers();
    }

    if (waypoints.length === 0) {
      if (trailPolyline) {
        map.removeLayer(trailPolyline);
        trailPolyline = null;
      }
      return;
    }

    const coords = waypoints.map(p => [p.latitude, p.longitude]);

    // Update or create polyline connecting points
    if (!trailPolyline) {
      trailPolyline = L.polyline(coords, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.75,
        dashArray: '6, 8',
        lineJoin: 'round'
      }).addTo(map);
    } else {
      trailPolyline.setLatLngs(coords);
      if (!map.hasLayer(trailPolyline)) {
        trailPolyline.addTo(map);
      }
    }

    // Add clickable waypoint circle markers along the route
    waypoints.forEach((p, index) => {
      const isLatest = index === waypoints.length - 1;
      const fillColor = p.isOfflineBuffered ? '#3b82f6' : (p.isStale ? '#f59e0b' : '#10b981');

      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: isLatest ? 7 : 5,
        color: '#1e3a8a',
        fillColor: fillColor,
        fillOpacity: 0.9,
        weight: 2
      });

      const fixLabel = p.isOfflineBuffered
        ? '📦 Offline Buffered'
        : (p.isStale ? '🕒 Stale Cache' : (p.isCached ? '🕒 Cached Fix' : '📡 Live GPS Fix'));

      const popupContent = `
        <div class="waypoint-popup">
          <h4>📍 Waypoint #${index + 1}</h4>
          <p><strong>🕒 Time:</strong> ${new Date(p.timestamp).toLocaleTimeString()} (${new Date(p.timestamp).toLocaleDateString()})</p>
          <p><strong>🔋 Battery:</strong> ${p.batteryPct >= 0 ? p.batteryPct + '%' : 'N/A'} ${p.isCharging ? '⚡' : ''}</p>
          <p><strong>🎯 Accuracy:</strong> ±${Math.round(p.accuracy)} m</p>
          <p><strong>🏷️ Fix Type:</strong> ${fixLabel}</p>
          <p><strong>🌐 Network:</strong> ${p.networkType || 'Unknown'}</p>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(waypointLayer);
    });

  } catch (err) {
    console.error('Failed to fetch location trail:', err);
  }
}

function formatMinutesAgo(mins, timestamp) {
  if (mins === undefined || mins === null) {
    return new Date(timestamp).toLocaleTimeString();
  }
  if (mins < 1) return 'Just now (<1m)';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m ago`;
}
