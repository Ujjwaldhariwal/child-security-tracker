// Leaflet Map Initialization
let map = null;
let currentMarker = null;
let accuracyCircle = null;
let trailPolyline = null;
const DEFAULT_COORDS = [28.6139, 77.2090]; // Default center (New Delhi) or fallback
const POLL_INTERVAL_MS = 15000; // Poll every 15s

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchLatestLocation();
  fetchLocationTrail();

  // Polling loop
  setInterval(() => {
    fetchLatestLocation();
    if (document.getElementById('chkShowTrail').checked) {
      fetchLocationTrail();
    }
  }, POLL_INTERVAL_MS);

  // Manual refresh button
  document.getElementById('btnRefresh').addEventListener('click', () => {
    const btn = document.getElementById('btnRefresh');
    btn.style.transform = 'rotate(180deg)';
    setTimeout(() => btn.style.transform = '', 300);
    fetchLatestLocation();
    fetchLocationTrail();
  });

  // Toggle trail
  document.getElementById('chkShowTrail').addEventListener('change', (e) => {
    if (e.target.checked) {
      fetchLocationTrail();
    } else if (trailPolyline) {
      map.removeLayer(trailPolyline);
      trailPolyline = null;
    }
  });
});

function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView(DEFAULT_COORDS, 14);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Free OpenStreetMap Tiles (standard, reliable, no API key needed)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

async function fetchLatestLocation() {
  try {
    const response = await fetch('/api/location/latest');
    if (!response.ok) {
      if (response.status === 404) {
        document.getElementById('valLastUpdated').textContent = 'No data yet (Pending first sync)';
        document.getElementById('statusIndicator').className = 'status-dot amber';
      }
      return;
    }

    const result = await response.json();
    if (!result.success || !result.data) return;

    renderLocation(result.data);
  } catch (err) {
    console.error('Failed to fetch latest location:', err);
    document.getElementById('statusIndicator').className = 'status-dot red';
  }
}

function renderLocation(data) {
  const { deviceId, latitude, longitude, accuracy, batteryPct, isCharging, timestamp, minutesAgo } = data;

  // 1. Update UI text
  document.getElementById('deviceTitle').textContent = deviceId;
  document.getElementById('valCoords').textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  document.getElementById('valAccuracy').textContent = `±${Math.round(accuracy)} m`;
  document.getElementById('valNetwork').textContent = data.networkType || 'Cell/WiFi';

  // Last seen text
  const timeText = formatMinutesAgo(minutesAgo, timestamp);
  document.getElementById('valLastUpdated').textContent = timeText;

  // Status dot
  const statusIndicator = document.getElementById('statusIndicator');
  if (minutesAgo <= 35) {
    statusIndicator.className = 'status-dot green';
  } else if (minutesAgo <= 75) {
    statusIndicator.className = 'status-dot amber';
  } else {
    statusIndicator.className = 'status-dot red';
  }

  // Battery indicator
  const batteryBadge = document.getElementById('batteryBadge');
  const batteryText = document.getElementById('batteryText');
  const batteryIcon = document.getElementById('batteryIcon');

  if (batteryPct >= 0) {
    batteryText.textContent = `${batteryPct}%${isCharging ? ' ⚡' : ''}`;
    if (batteryPct > 50) batteryBadge.style.color = '#10b981';
    else if (batteryPct > 20) batteryBadge.style.color = '#f59e0b';
    else batteryBadge.style.color = '#ef4444';
  } else {
    batteryText.textContent = '--%';
  }

  // Google Maps link
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  document.getElementById('btnExternalMaps').href = mapsUrl;

  // 2. Update Map Marker
  const latLng = [latitude, longitude];

  if (!currentMarker) {
    // Custom Pulsing Icon
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
    map.setView(latLng, 16);
  } else {
    currentMarker.setLatLng(latLng);
  }

  // Update Accuracy Circle
  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: Math.max(accuracy, 15),
      color: '#3b82f6',
      fillColor: '#93c5fd',
      fillOpacity: 0.25,
      weight: 1
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(Math.max(accuracy, 15));
  }
}

async function fetchLocationTrail() {
  try {
    const response = await fetch('/api/location/history?limit=40');
    if (!response.ok) return;

    const result = await response.json();
    if (!result.success || !result.data || result.data.length < 2) return;

    const coords = result.data.map(p => [p.latitude, p.longitude]);

    if (!trailPolyline) {
      trailPolyline = L.polyline(coords, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7,
        dashArray: '6, 8',
        lineJoin: 'round'
      }).addTo(map);
    } else {
      trailPolyline.setLatLngs(coords);
    }
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
