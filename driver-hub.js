/* ============================================
   SmartLane — Unified Driver Hub Logic
   Allows any user to drive & view other vehicles directly in the app
   ============================================ */

const HUB_LANE_MAP = {
    bike:  { lane: 1, name: 'Lane 1 (Bikes)',  color: '#2e7d32', emoji: '🏍️' },
    car:   { lane: 2, name: 'Lane 2 (Cars)',   color: '#1565c0', emoji: '🚗' },
    van:   { lane: 3, name: 'Lane 3 (Vans)',   color: '#e65100', emoji: '🚐' },
    truck: { lane: 4, name: 'Lane 4 (Trucks)', color: '#b71c1c', emoji: '🚛' }
};

let hubMap = null;
let hubMyMarker = null;
let hubZoneCircle = null;
let hubSelectedType = null;
let hubSharing = false;
let hubGpsWatchId = null;
let hubDriverId = 'driver_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
let hubMyLat = null;
let hubMyLng = null;
let hubOtherVehicles = new Map(); // id -> { data, marker }

function initDriverHub() {
    if (hubMap) {
        setTimeout(() => hubMap.invalidateSize(), 200);
        return;
    }

    const mapEl = document.getElementById('hub-map');
    if (!mapEl) return;

    hubMap = L.map('hub-map', {
        zoomControl: true,
        attributionControl: false
    }).setView([28.4305, 77.1121], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(hubMap);

    hubMap.getPane('tilePane').style.filter = 'invert(1) hue-rotate(180deg) brightness(0.8) contrast(1.2)';
    setTimeout(() => hubMap.invalidateSize(), 300);

    // Sync with Firebase or Socket
    setupHubRealtime();
}

function setupHubRealtime() {
    if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        const db = firebase.database();

        // Listen for Checkpoint Zone
        db.ref('zone').on('value', (snap) => {
            const data = snap.val();
            if (data && data.lat) {
                updateHubZone(data);
            } else {
                clearHubZone();
            }
        });

        // Listen for all vehicles on the road
        const vRef = db.ref('vehicles');
        vRef.on('child_added', (snap) => {
            if (snap.key !== hubDriverId) updateHubOtherVehicle(snap.key, snap.val());
        });
        vRef.on('child_changed', (snap) => {
            if (snap.key !== hubDriverId) updateHubOtherVehicle(snap.key, snap.val());
        });
        vRef.on('child_removed', (snap) => {
            removeHubOtherVehicle(snap.key);
        });

        db.ref('vehicles/' + hubDriverId).onDisconnect().remove();
    } else if (typeof io !== 'undefined') {
        const s = io(window.location.origin, { query: { role: 'driver' } });
        s.on('zone:update', (z) => updateHubZone(z));
        s.on('zone:removed', () => clearHubZone());
        s.on('vehicles:all', (list) => {
            list.forEach(v => { if (v.id !== hubDriverId) updateHubOtherVehicle(v.id, v); });
        });
        s.on('vehicle:update', (v) => {
            if (v.id !== hubDriverId) updateHubOtherVehicle(v.id, v);
        });
        s.on('vehicle:left', (data) => removeHubOtherVehicle(data.id));
    }
}

function hubSelectType(type) {
    hubSelectedType = type;
    document.querySelectorAll('.d-type-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('hub-btn-' + type).classList.add('selected');

    const btn = document.getElementById('hub-start-btn');
    btn.disabled = false;
    btn.textContent = `📡 Drive as ${HUB_LANE_MAP[type].emoji} ${type.toUpperCase()}`;
}

function hubToggleDriving() {
    if (!hubSelectedType) return;
    if (!hubSharing) hubStartDriving();
    else hubStopDriving();
}

function hubStartDriving() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported on this browser');
        return;
    }

    const name = document.getElementById('hub-driver-name').value.trim() || 'Driver ' + Math.floor(Math.random() * 800 + 100);

    hubSharing = true;
    const btn = document.getElementById('hub-start-btn');
    btn.textContent = '⏹ Stop Driving & Leave Road';
    btn.classList.add('sharing');

    // Send initial registration to Firebase
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('vehicles/' + hubDriverId).set({
            name: name,
            type: hubSelectedType,
            lat: null,
            lng: null,
            speed: 0,
            timestamp: Date.now()
        });
    }

    hubGpsWatchId = navigator.geolocation.watchPosition(
        hubOnGPS,
        (err) => console.warn('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
}

function hubStopDriving() {
    hubSharing = false;
    if (hubGpsWatchId !== null) {
        navigator.geolocation.clearWatch(hubGpsWatchId);
        hubGpsWatchId = null;
    }

    if (hubMyMarker && hubMap.hasLayer(hubMyMarker)) {
        hubMap.removeLayer(hubMyMarker);
        hubMyMarker = null;
    }

    if (typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('vehicles/' + hubDriverId).remove();
    }

    const btn = document.getElementById('hub-start-btn');
    btn.textContent = `📡 Drive as ${HUB_LANE_MAP[hubSelectedType].emoji} ${hubSelectedType.toUpperCase()}`;
    btn.classList.remove('sharing');

    document.getElementById('hub-zone-alert').classList.remove('visible');
    renderHubRoster();
}

function hubOnGPS(pos) {
    if (!hubSharing) return;

    hubMyLat = pos.coords.latitude;
    hubMyLng = pos.coords.longitude;
    const speed = pos.coords.speed ? (pos.coords.speed * 3.6).toFixed(1) : 0;
    const heading = pos.coords.heading || 0;

    // Send to Firebase
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('vehicles/' + hubDriverId).update({
            lat: hubMyLat,
            lng: hubMyLng,
            speed: parseFloat(speed),
            heading: heading,
            timestamp: Date.now()
        });
    }

    // Update marker on mini radar
    if (hubMap) {
        if (!hubMyMarker) {
            const laneInfo = HUB_LANE_MAP[hubSelectedType] || HUB_LANE_MAP.car;
            const icon = L.divIcon({
                className: 'hub-my-marker',
                html: `<div style="background:${laneInfo.color};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #00d4ff;box-shadow:0 0 16px #00d4ff;">${laneInfo.emoji}</div>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            hubMyMarker = L.marker([hubMyLat, hubMyLng], { icon, zIndexOffset: 1000 }).addTo(hubMap);
            hubMap.setView([hubMyLat, hubMyLng], 17);
        } else {
            hubMyMarker.setLatLng([hubMyLat, hubMyLng]);
        }
    }

    checkHubZoneProximity(hubMyLat, hubMyLng);
    renderHubRoster();
}

let hubCurrentZone = null;
function updateHubZone(zone) {
    hubCurrentZone = zone;
    if (hubMap) {
        if (hubZoneCircle) hubMap.removeLayer(hubZoneCircle);
        hubZoneCircle = L.circle([zone.lat, zone.lng], {
            radius: zone.radius,
            color: '#00d4ff',
            fillColor: '#00d4ff',
            fillOpacity: 0.1,
            weight: 2,
            dashArray: '6 4'
        }).addTo(hubMap);
    }
    if (hubMyLat && hubMyLng) checkHubZoneProximity(hubMyLat, hubMyLng);
}

function clearHubZone() {
    hubCurrentZone = null;
    if (hubZoneCircle && hubMap) {
        hubMap.removeLayer(hubZoneCircle);
        hubZoneCircle = null;
    }
    document.getElementById('hub-zone-alert').classList.remove('visible');
}

function checkHubZoneProximity(lat, lng) {
    if (!hubCurrentZone) {
        document.getElementById('hub-zone-alert').classList.remove('visible');
        return;
    }

    const dist = Math.round(hubHaversine(lat, lng, hubCurrentZone.lat, hubCurrentZone.lng));
    const alertEl = document.getElementById('hub-zone-alert');

    if (dist <= hubCurrentZone.radius) {
        alertEl.classList.add('visible');
        const target = HUB_LANE_MAP[hubSelectedType] || HUB_LANE_MAP.car;
        document.getElementById('hub-lane-title').textContent = `→ ${target.name}`;
        document.getElementById('hub-distance-hint').textContent = `Approaching Checkpoint (${dist}m away). Align into matching lane now!`;
    } else {
        alertEl.classList.remove('visible');
    }
}

function updateHubOtherVehicle(id, data) {
    if (!data || data.lat === null || data.lat === undefined) return;

    let entry = hubOtherVehicles.get(id);
    const laneInfo = HUB_LANE_MAP[data.type] || HUB_LANE_MAP.car;

    if (!entry) {
        const icon = L.divIcon({
            className: 'hub-vehicle-marker',
            html: `<div style="background:${laneInfo.color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);">${laneInfo.emoji}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });
        const marker = L.marker([data.lat, data.lng], { icon, zIndexOffset: 500 })
            .addTo(hubMap)
            .bindPopup(`<strong>${data.name || 'Vehicle'}</strong><br>${laneInfo.name}`);

        hubOtherVehicles.set(id, { data, marker });
    } else {
        entry.data = data;
        entry.marker.setLatLng([data.lat, data.lng]);
    }

    renderHubRoster();
}

function removeHubOtherVehicle(id) {
    const entry = hubOtherVehicles.get(id);
    if (entry && entry.marker && hubMap.hasLayer(entry.marker)) {
        hubMap.removeLayer(entry.marker);
    }
    hubOtherVehicles.delete(id);
    renderHubRoster();
}

function renderHubRoster() {
    const rosterEl = document.getElementById('hub-roster-list');
    if (!rosterEl) return;

    const countBadge = document.getElementById('hub-radar-count');
    if (countBadge) countBadge.textContent = `${hubOtherVehicles.size} vehicle(s) nearby`;

    if (!hubSharing && hubOtherVehicles.size === 0) {
        rosterEl.innerHTML = '<div style="color:#666;font-size:0.85rem;text-align:center;padding:12px 0;">No active vehicles currently online. Start driving to join!</div>';
        return;
    }

    const items = [];

    if (hubSharing) {
        const myInfo = HUB_LANE_MAP[hubSelectedType] || HUB_LANE_MAP.car;
        items.push(`
            <div class="hub-roster-item self lane-${myInfo.lane}">
                <div>
                    <span style="font-size:1.1rem;margin-right:6px;">${myInfo.emoji}</span>
                    <span class="hub-roster-name">You (${document.getElementById('hub-driver-name').value || 'My Vehicle'})</span>
                    <div class="hub-roster-lane">Target: ${myInfo.name}</div>
                </div>
                <span class="hub-roster-dist" style="color:#00d4ff;font-weight:700;">ACTIVE</span>
            </div>
        `);
    }

    hubOtherVehicles.forEach((entry) => {
        const v = entry.data;
        const vInfo = HUB_LANE_MAP[v.type] || HUB_LANE_MAP.car;
        let distStr = 'Online';
        if (hubMyLat && hubMyLng && v.lat && v.lng) {
            const d = Math.round(hubHaversine(hubMyLat, hubMyLng, v.lat, v.lng));
            distStr = d < 1000 ? `${d}m away` : `${(d/1000).toFixed(1)}km away`;
        }

        items.push(`
            <div class="hub-roster-item lane-${vInfo.lane}">
                <div>
                    <span style="font-size:1.1rem;margin-right:6px;">${vInfo.emoji}</span>
                    <span class="hub-roster-name">${v.name || 'Vehicle'}</span>
                    <div class="hub-roster-lane">Assigned: ${vInfo.name}</div>
                </div>
                <span class="hub-roster-dist">${distStr}</span>
            </div>
        `);
    });

    rosterEl.innerHTML = items.join('');
}

function hubHaversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
