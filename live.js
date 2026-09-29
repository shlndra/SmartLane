/* ============================================
   SmartLane — Live Road Mode
   Dual-mode: Socket.io (local) / Firebase (Vercel)
   ============================================ */

// ---- State ----
let map = null;
let liveInitialized = false;
let userMarker = null;
let zoneMarker = null;
let zoneCircle = null;
let zoneLat = null;
let zoneLng = null;
let zoneRadius = 500;
let gpsWatchId = null;
let userLat = null;
let userLng = null;

let dashSocket = null;
let firebaseDB = null;
let connectionMode = null; // 'socket' or 'firebase'

let realVehicles = new Map();
let liveStats = { total: 0, detected: 0, sorted: 0, passed: 0 };
let liveTypeCounts = { bike: 0, car: 0, van: 0, truck: 0 };

const LIVE_VEHICLE_TYPES = {
    bike:  { emoji: '🏍️', label: 'Bike',  lane: 1, color: '#2e7d32' },
    car:   { emoji: '🚗', label: 'Car',   lane: 2, color: '#1565c0' },
    van:   { emoji: '🚐', label: 'Van',   lane: 3, color: '#e65100' },
    truck: { emoji: '🚛', label: 'Truck', lane: 4, color: '#b71c1c' },
};

// ---- Map Vehicle Icons ----
function createVehicleIcon(type, detected) {
    const info = LIVE_VEHICLE_TYPES[type] || LIVE_VEHICLE_TYPES.car;
    const size = detected ? 40 : 34;
    const border = detected ? '3px solid #00d4ff' : '2px solid #fff';
    const shadow = detected
        ? '0 0 18px rgba(0,212,255,0.7), 0 2px 8px rgba(0,0,0,0.5)'
        : '0 2px 8px rgba(0,0,0,0.5)';

    return L.divIcon({
        className: 'map-vehicle-icon',
        html: `<div style="
            background:${info.color};
            width:${size}px; height:${size}px;
            border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            font-size:${detected ? 20 : 17}px;
            border:${border};
            box-shadow:${shadow};
            transition:all 0.3s;
        ">${info.emoji}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

// ---- Detect Connection Mode ----
function detectMode() {
    if (typeof io !== 'undefined') {
        connectionMode = 'socket';
        console.log('🔌 Using Socket.io (local server)');
    } else if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
        connectionMode = 'firebase';
        console.log('🔥 Using Firebase (Vercel deployment)');
    } else {
        connectionMode = null;
        console.warn('⚠️ No real-time backend available. Configure Firebase or run the local server.');
    }
    return connectionMode;
}

// ---- Initialize Live Mode ----
function initLiveMode() {
    if (liveInitialized) {
        setTimeout(() => map.invalidateSize(), 100);
        return;
    }
    liveInitialized = true;

    const defaultLat = 20.5937;
    const defaultLng = 78.9629;

    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([defaultLat, defaultLng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(map);

    map.getPane('tilePane').style.filter = 'invert(1) hue-rotate(180deg) brightness(0.8) contrast(1.2)';
    setTimeout(() => map.invalidateSize(), 200);

    map.on('click', (e) => placeZone(e.latlng.lat, e.latlng.lng));

    startGPS();

    // Connect to real-time backend
    const mode = detectMode();
    if (mode === 'socket') {
        connectSocket();
    } else if (mode === 'firebase') {
        connectFirebase();
    }

    setInterval(updateLiveDetection, 1000);

    // Show driver link
    const driverLink = window.location.origin + '/driver';
    document.getElementById('driver-link').textContent = driverLink;
}

// ============================================
//  MODE 1: SOCKET.IO (Local Development)
// ============================================
function connectSocket() {
    dashSocket = io(window.location.origin, { query: { role: 'dashboard' } });

    dashSocket.on('connect', () => console.log('📊 Dashboard connected via Socket.io'));

    dashSocket.on('vehicles:all', (vehicles) => {
        vehicles.forEach(v => addRealVehicle(v.id, v));
        updateConnectedCount();
    });

    dashSocket.on('vehicle:joined', (data) => {
        addRealVehicle(data.id, data);
        updateConnectedCount();
    });

    dashSocket.on('vehicle:update', (data) => {
        updateRealVehicle(data.id, data);
    });

    dashSocket.on('vehicle:left', (data) => {
        removeRealVehicle(data.id);
        updateConnectedCount();
    });
}

// ============================================
//  MODE 2: FIREBASE (Vercel Deployment)
// ============================================
function connectFirebase() {
    firebase.initializeApp(firebaseConfig);
    firebaseDB = firebase.database();

    const vehiclesRef = firebaseDB.ref('vehicles');

    // Listen for drivers joining / updating GPS
    vehiclesRef.on('child_added', (snap) => {
        const data = snap.val();
        if (data) addRealVehicle(snap.key, data);
        updateConnectedCount();
    });

    vehiclesRef.on('child_changed', (snap) => {
        const data = snap.val();
        if (data) updateRealVehicle(snap.key, data);
    });

    vehiclesRef.on('child_removed', (snap) => {
        removeRealVehicle(snap.key);
        updateConnectedCount();
    });

    // Load existing zone
    firebaseDB.ref('zone').on('value', (snap) => {
        const data = snap.val();
        if (data && data.lat) {
            // Zone was set by another dashboard
            // Don't override if we already have one
        }
    });
}

// ============================================
//  Vehicle Management (shared for both modes)
// ============================================
function addRealVehicle(id, data) {
    if (realVehicles.has(id)) return;

    const info = LIVE_VEHICLE_TYPES[data.type] || LIVE_VEHICLE_TYPES.car;

    const vehicle = {
        id: id,
        type: data.type,
        name: data.name || 'Driver',
        lat: data.lat,
        lng: data.lng,
        speed: data.speed || 0,
        marker: null,
        detected: false,
        eta: null,
    };

    if (data.lat !== null && data.lat !== undefined) {
        vehicle.marker = L.marker([data.lat, data.lng], {
            icon: createVehicleIcon(data.type, false),
            zIndexOffset: 500,
        }).addTo(map)
          .bindPopup(`${info.emoji} <strong>${vehicle.name}</strong><br>Type: ${info.label} | Lane ${info.lane}`);
    }

    realVehicles.set(id, vehicle);
    liveTypeCounts[data.type] = (liveTypeCounts[data.type] || 0) + 1;
    liveStats.total++;
    updateLiveDashboard();
}

function updateRealVehicle(id, data) {
    let vehicle = realVehicles.get(id);

    if (!vehicle) {
        addRealVehicle(id, data);
        vehicle = realVehicles.get(id);
        if (!vehicle) return;
    }

    vehicle.lat = data.lat;
    vehicle.lng = data.lng;
    vehicle.speed = data.speed || 0;
    if (data.name) vehicle.name = data.name;

    const info = LIVE_VEHICLE_TYPES[data.type] || LIVE_VEHICLE_TYPES.car;

    if (vehicle.marker) {
        vehicle.marker.setLatLng([data.lat, data.lng]);
    } else if (data.lat !== null) {
        vehicle.marker = L.marker([data.lat, data.lng], {
            icon: createVehicleIcon(data.type, vehicle.detected),
            zIndexOffset: 500,
        }).addTo(map)
          .bindPopup(`${info.emoji} <strong>${vehicle.name}</strong><br>Type: ${info.label} | Lane ${info.lane}`);
    }

    updateLiveDashboard();
}

function removeRealVehicle(id) {
    const vehicle = realVehicles.get(id);
    if (!vehicle) return;

    if (vehicle.marker && map.hasLayer(vehicle.marker)) map.removeLayer(vehicle.marker);
    if (liveTypeCounts[vehicle.type] > 0) liveTypeCounts[vehicle.type]--;
    liveStats.passed++;

    realVehicles.delete(id);
    updateLiveDashboard();
}

// ---- Detection Zone Logic ----
function updateLiveDetection() {
    if (zoneLat === null) return;

    let detectedCount = 0;
    realVehicles.forEach((vehicle) => {
        if (!vehicle.lat) return;

        const dist = haversineDistance(vehicle.lat, vehicle.lng, zoneLat, zoneLng);
        const wasDetected = vehicle.detected;

        if (dist <= zoneRadius) {
            vehicle.detected = true;
            detectedCount++;
            vehicle.eta = vehicle.speed > 0
                ? Math.max(0, Math.round(dist / (vehicle.speed / 3.6)))
                : Math.round(dist / 10);

            if (!wasDetected && vehicle.marker) {
                vehicle.marker.setIcon(createVehicleIcon(vehicle.type, true));
            }
        } else {
            vehicle.detected = false;
            vehicle.eta = null;
            if (wasDetected && vehicle.marker) {
                vehicle.marker.setIcon(createVehicleIcon(vehicle.type, false));
            }
        }
    });

    liveStats.detected = detectedCount;
    updateLiveDashboard();
}

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- GPS for Dashboard ----
function startGPS() {
    const statusEl = document.getElementById('gps-status');
    const coordsEl = document.getElementById('gps-coords');
    const accuracyEl = document.getElementById('gps-accuracy');

    if (!navigator.geolocation) {
        statusEl.textContent = '❌ GPS not supported';
        statusEl.className = 'gps-status error';
        onGPSPosition(20.5937, 78.9629);
        return;
    }

    statusEl.textContent = '📡 Acquiring GPS...';
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;
            statusEl.textContent = '📡 GPS Connected';
            statusEl.className = 'gps-status connected';
            coordsEl.textContent = `${userLat.toFixed(5)}, ${userLng.toFixed(5)}`;
            accuracyEl.textContent = `Accuracy: ${Math.round(pos.coords.accuracy)}m`;
            onGPSPosition(userLat, userLng);
        },
        () => {
            statusEl.textContent = '⚠️ GPS denied — using default';
            statusEl.className = 'gps-status error';
            onGPSPosition(20.5937, 78.9629);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function onGPSPosition(lat, lng) {
    if (!map) return;
    if (userMarker) {
        userMarker.setLatLng([lat, lng]);
    } else {
        const userIcon = L.divIcon({
            className: 'user-marker',
            html: `<div style="width:18px;height:18px;background:#00d4ff;border:3px solid #fff;border-radius:50%;box-shadow:0 0 15px rgba(0,212,255,0.6);"></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9],
        });
        userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 })
            .addTo(map).bindPopup('📍 You (Dashboard)');
        map.setView([lat, lng], 16);
    }
}

// ---- Zone Management ----
function placeZone(lat, lng) {
    zoneLat = lat;
    zoneLng = lng;

    if (zoneMarker) map.removeLayer(zoneMarker);
    if (zoneCircle) map.removeLayer(zoneCircle);

    const zoneIcon = L.divIcon({
        className: 'zone-marker',
        html: `<div style="width:28px;height:28px;background:#4caf50;border:3px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 15px rgba(76,175,80,0.5);">🏁</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14],
    });

    zoneMarker = L.marker([lat, lng], { icon: zoneIcon, zIndexOffset: 900 })
        .addTo(map)
        .bindPopup('🏁 <strong>Zone / Checkpoint</strong><br>Vehicles sort into lanes here')
        .openPopup();

    zoneCircle = L.circle([lat, lng], {
        radius: zoneRadius, color: '#00d4ff', fillColor: '#00d4ff',
        fillOpacity: 0.08, weight: 2, dashArray: '8 6',
    }).addTo(map);

    map.fitBounds(zoneCircle.getBounds().pad(0.3));

    // Notify backend
    if (connectionMode === 'socket' && dashSocket) {
        dashSocket.emit('zone:set', { lat, lng, radius: zoneRadius });
    } else if (connectionMode === 'firebase' && firebaseDB) {
        firebaseDB.ref('zone').set({ lat, lng, radius: zoneRadius });
    }
}

function liveRemoveZone() {
    if (zoneMarker) { map.removeLayer(zoneMarker); zoneMarker = null; }
    if (zoneCircle) { map.removeLayer(zoneCircle); zoneCircle = null; }
    zoneLat = null; zoneLng = null;

    if (connectionMode === 'socket' && dashSocket) dashSocket.emit('zone:remove');
    else if (connectionMode === 'firebase' && firebaseDB) firebaseDB.ref('zone').remove();

    updateLiveDashboard();
}

function liveUpdateRadius(val) {
    zoneRadius = parseInt(val);
    document.getElementById('radius-label').textContent = val + 'm';
    if (zoneCircle && zoneLat !== null) {
        zoneCircle.setRadius(zoneRadius);
        map.fitBounds(zoneCircle.getBounds().pad(0.3));
    }
    if (zoneLat !== null) {
        if (connectionMode === 'socket' && dashSocket) dashSocket.emit('zone:set', { lat: zoneLat, lng: zoneLng, radius: zoneRadius });
        else if (connectionMode === 'firebase' && firebaseDB) firebaseDB.ref('zone').set({ lat: zoneLat, lng: zoneLng, radius: zoneRadius });
    }
}

function liveCenterOnUser() {
    if (userLat !== null && map) map.setView([userLat, userLng], 16);
}

// ---- Copy Driver Link ----
function copyDriverLink() {
    const link = window.location.origin + '/driver';
    navigator.clipboard.writeText(link).then(() => {
        const btn = event.target;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy Driver Link'; }, 2000);
    }).catch(() => prompt('Copy this link:', link));
}

// ---- Connected Count ----
function updateConnectedCount() {
    const count = realVehicles.size;
    const el = document.getElementById('connected-count');
    if (el) {
        el.textContent = count === 0 ? '⏳ Waiting for drivers...' : `✅ ${count} driver${count > 1 ? 's' : ''} connected`;
        el.style.color = count > 0 ? '#4caf50' : '#ffd600';
    }
}

// ---- Dashboard UI Updates ----
function updateLiveDashboard() {
    document.getElementById('live-stat-total').textContent = realVehicles.size;
    document.getElementById('live-stat-detected').textContent = liveStats.detected;
    document.getElementById('live-stat-sorted').textContent = liveStats.sorted;
    document.getElementById('live-stat-passed').textContent = liveStats.passed;

    document.getElementById('live-count-bike').textContent = liveTypeCounts.bike;
    document.getElementById('live-count-car').textContent = liveTypeCounts.car;
    document.getElementById('live-count-van').textContent = liveTypeCounts.van;
    document.getElementById('live-count-truck').textContent = liveTypeCounts.truck;

    const listEl = document.getElementById('live-vehicle-list');
    const approaching = [];
    realVehicles.forEach(v => { if (v.detected) approaching.push(v); });

    if (zoneLat === null) {
        listEl.innerHTML = '<p class="empty-msg">📌 Click on the map to place a detection zone</p>';
    } else if (realVehicles.size === 0) {
        listEl.innerHTML = `<p class="empty-msg">📱 No drivers connected<br><br>Share the driver link to see real vehicles here</p>`;
    } else if (approaching.length === 0) {
        listEl.innerHTML = `<p class="empty-msg">✅ ${realVehicles.size} driver(s) online<br>None in detection range yet</p>`;
    } else {
        listEl.innerHTML = approaching
            .sort((a, b) => (a.eta || 99) - (b.eta || 99))
            .map(v => {
                const vInfo = LIVE_VEHICLE_TYPES[v.type] || LIVE_VEHICLE_TYPES.car;
                return `
                <div class="vl-item detected">
                    <span class="vl-emoji">${vInfo.emoji}</span>
                    <div class="vl-info">
                        <div class="vl-type">${v.name}</div>
                        <div class="vl-lane">→ Lane ${vInfo.lane} (${vInfo.label})</div>
                    </div>
                    <span class="vl-eta">${v.eta !== null ? v.eta + 's' : '—'}</span>
                </div>`;
            }).join('');
    }
    updateConnectedCount();
}
