/* ============================================
   SmartLane — Unified Driver Hub Logic
   Allows any user to drive & view other vehicles directly in the app
   ============================================ */

// ---- SIZE CATEGORIES (for lane assignment) ----
const LANE_CATEGORIES = {
    small:  { lane: 1, name: 'Lane 1 (Small)',  color: '#2e7d32' },
    medium: { lane: 2, name: 'Lane 2 (Medium)', color: '#1565c0' },
    large:  { lane: 3, name: 'Lane 3 (Large)',  color: '#e65100' },
    heavy:  { lane: 4, name: 'Lane 4 (Heavy)',  color: '#b71c1c' },
};

// ---- FULL INDIAN VEHICLE REGISTRY ----
const VEHICLE_REGISTRY = {
    // Small Vehicles (Lane 1)
    cycle:      { emoji: '🚲', label: 'Bicycle',         category: 'small' },
    escooter:   { emoji: '🛴', label: 'E-Scooter',       category: 'small' },
    bike:       { emoji: '🏍️', label: 'Motorcycle',      category: 'small' },
    scooty:     { emoji: '🛵', label: 'Scooty/Moped',    category: 'small' },

    // Medium Vehicles (Lane 2)
    auto:       { emoji: '🛺', label: 'Auto Rickshaw',   category: 'medium' },
    erickshaw:  { emoji: '🔋', label: 'E-Rickshaw',      category: 'medium' },
    car:        { emoji: '🚗', label: 'Car',             category: 'medium' },
    taxi:       { emoji: '🚕', label: 'Taxi/Cab',        category: 'medium' },
    suv:        { emoji: '🚙', label: 'SUV/Jeep',        category: 'medium' },

    // Large Vehicles (Lane 3)
    van:        { emoji: '🚐', label: 'Van/Tempo',       category: 'large' },
    minibus:    { emoji: '🚌', label: 'Mini Bus',        category: 'large' },
    ambulance:  { emoji: '🚑', label: 'Ambulance',       category: 'large' },
    pickup:     { emoji: '🛻', label: 'Pickup Truck',    category: 'large' },

    // Heavy Vehicles (Lane 4)
    bus:        { emoji: '🚌', label: 'Bus',             category: 'heavy' },
    truck:      { emoji: '🚛', label: 'Truck/Lorry',     category: 'heavy' },
    tractor:    { emoji: '🚜', label: 'Tractor',         category: 'heavy' },
    tanker:     { emoji: '🛢️', label: 'Tanker',          category: 'heavy' },
    trailer:    { emoji: '🚛', label: 'Trailer/18-Wheeler', category: 'heavy' },
};

// Helper: get lane info for any vehicle type (including custom)
function getVehicleLaneInfo(type) {
    const reg = VEHICLE_REGISTRY[type];
    if (reg) {
        const cat = LANE_CATEGORIES[reg.category];
        return { lane: cat.lane, name: cat.name, color: cat.color, emoji: reg.emoji, label: reg.label, category: reg.category };
    }
    // Custom vehicle — default to medium
    const customCat = hubCustomCategory || 'medium';
    const cat = LANE_CATEGORIES[customCat];
    return { lane: cat.lane, name: cat.name, color: cat.color, emoji: '🚙', label: type, category: customCat };
}

// Backwards compat
const HUB_LANE_MAP = new Proxy({}, {
    get(target, key) {
        return getVehicleLaneInfo(key);
    }
});

let hubCustomCategory = 'medium';

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
    const btnEl = document.getElementById('hub-btn-' + type);
    if (btnEl) btnEl.classList.add('selected');

    const info = getVehicleLaneInfo(type);
    const btn = document.getElementById('hub-start-btn');
    btn.disabled = false;
    btn.textContent = `📡 Drive as ${info.emoji} ${info.label} → ${info.name}`;

    // Show lane instruction immediately
    showLaneInstruction(info);
}

function hubSelectCustom() {
    const nameInput = document.getElementById('hub-custom-name');
    const sizeSelect = document.getElementById('hub-custom-size');
    const customName = nameInput.value.trim();

    if (!customName) {
        nameInput.style.borderColor = '#ff5252';
        nameInput.placeholder = '⚠️ Enter your vehicle name first!';
        setTimeout(() => { nameInput.style.borderColor = '#9c27b0'; nameInput.placeholder = 'e.g. JCB, Crane, Bullock Cart...'; }, 2000);
        return;
    }

    // Register custom vehicle dynamically
    const customKey = customName.toLowerCase().replace(/[^a-z0-9]/g, '');
    hubCustomCategory = sizeSelect.value;

    VEHICLE_REGISTRY[customKey] = {
        emoji: '🚙',
        label: customName,
        category: hubCustomCategory
    };

    // Clear all selections and highlight the custom
    document.querySelectorAll('.d-type-btn').forEach(b => b.classList.remove('selected'));

    hubSelectedType = customKey;
    const info = getVehicleLaneInfo(customKey);
    const btn = document.getElementById('hub-start-btn');
    btn.disabled = false;
    btn.textContent = `📡 Drive as 🚙 ${customName} → ${info.name}`;

    nameInput.value = '';
    nameInput.style.borderColor = '#4caf50';
    setTimeout(() => { nameInput.style.borderColor = '#9c27b0'; }, 1500);
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

    // Keep traffic bars updated live
    renderLaneTrafficBars();

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

// ============================================
//  BIG LANE INSTRUCTION HUD
// ============================================
function showLaneInstruction(info) {
    const card = document.getElementById('hub-lane-card');
    const el = document.getElementById('hub-lane-instruction');
    if (!card || !el) return;

    card.style.display = 'block';

    const laneColors = { 1: '#2e7d32', 2: '#1565c0', 3: '#e65100', 4: '#b71c1c' };
    const laneColor = laneColors[info.lane] || '#1565c0';
    const laneNames = { 1: 'LEFT LANE', 2: 'CENTER-LEFT LANE', 3: 'CENTER-RIGHT LANE', 4: 'RIGHT LANE' };
    const posName = laneNames[info.lane] || 'LANE ' + info.lane;

    el.innerHTML = `
        <div style="font-size:0.8rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">
            Your Vehicle: ${info.emoji} ${info.label}
        </div>
        <div style="
            font-size:2.2rem;
            font-weight:900;
            color:#fff;
            background:${laneColor};
            padding:18px 20px;
            border-radius:14px;
            margin:8px 0;
            text-shadow:0 2px 8px rgba(0,0,0,0.4);
            box-shadow:0 4px 20px ${laneColor}66;
        ">
            🛣️ DRIVE IN LANE ${info.lane}
        </div>
        <div style="font-size:1rem;color:#00d4ff;font-weight:700;margin-top:4px;">
            ${posName} — ${info.name}
        </div>
        <div style="display:flex;justify-content:center;gap:8px;margin-top:12px;">
            ${[1,2,3,4].map(n => `
                <div style="
                    width:50px;height:60px;
                    background:${n === info.lane ? laneColor : '#1a1a2e'};
                    border:2px solid ${n === info.lane ? '#fff' : '#333'};
                    border-radius:6px;
                    display:flex;flex-direction:column;align-items:center;justify-content:center;
                    font-size:${n === info.lane ? '1.2rem' : '0.7rem'};
                    color:${n === info.lane ? '#fff' : '#666'};
                    font-weight:${n === info.lane ? '800' : '400'};
                    ${n === info.lane ? 'box-shadow:0 0 12px ' + laneColor + '88;animation:lane-pulse 1.5s infinite;' : ''}
                ">
                    <span>L${n}</span>
                    ${n === info.lane ? '<span style="font-size:0.6rem;margin-top:2px;">YOU</span>' : ''}
                </div>
            `).join('')}
        <div style="
            margin-top:14px;
            padding:10px 14px;
            background:#101726;
            border-radius:8px;
            border-left:4px solid #00d4ff;
            text-align:left;
            font-size:0.78rem;
            color:#cbd5e1;
            line-height:1.4;
        ">
            <strong style="color:#00d4ff;">🛡️ Safe Zipper-Merge Protocol (No Overtaking):</strong><br>
            • Shift <strong>one lane at a time</strong> — do not sweep across multiple lanes.<br>
            • If an adjacent vehicle is alongside, <strong>gently yield and merge behind</strong> it.<br>
            • Always indicate early and maintain safe 2-second braking distance.
        </div>
        <style>
            @keyframes lane-pulse {
                0%,100% { transform:scale(1); }
                50% { transform:scale(1.08); }
            }
        </style>
    `;

    // Also show traffic bars
    renderLaneTrafficBars();
}

// ============================================
//  LIVE LANE TRAFFIC BARS
// ============================================
function renderLaneTrafficBars() {
    const card = document.getElementById('hub-traffic-card');
    const container = document.getElementById('hub-lane-bars');
    if (!card || !container) return;

    card.style.display = 'block';

    // Count vehicles per lane
    const laneCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

    // Count self
    if (hubSharing && hubSelectedType) {
        const myInfo = getVehicleLaneInfo(hubSelectedType);
        laneCounts[myInfo.lane]++;
    }

    // Count others
    hubOtherVehicles.forEach(entry => {
        const vInfo = getVehicleLaneInfo(entry.data.type);
        laneCounts[vInfo.lane]++;
    });

    const total = Object.values(laneCounts).reduce((a,b) => a+b, 0) || 1;

    const laneLabels = {
        1: { name: 'Lane 1 — Small', color: '#2e7d32', types: '🚲🛴🏍️🛵' },
        2: { name: 'Lane 2 — Medium', color: '#1565c0', types: '🛺🔋🚗🚕🚙' },
        3: { name: 'Lane 3 — Large', color: '#e65100', types: '🚐🚌🚑🛻' },
        4: { name: 'Lane 4 — Heavy', color: '#b71c1c', types: '🚌🚛🚜🛢️' },
    };

    const myLane = hubSelectedType ? getVehicleLaneInfo(hubSelectedType).lane : 0;

    container.innerHTML = Object.entries(laneLabels).map(([laneNum, lane]) => {
        const count = laneCounts[laneNum];
        const pct = Math.round((count / total) * 100);
        const isMyLane = parseInt(laneNum) === myLane;

        return `
            <div style="
                background:${isMyLane ? lane.color + '22' : '#0f1424'};
                border:${isMyLane ? '2px solid ' + lane.color : '1px solid #1a2a4e'};
                border-radius:8px;
                padding:8px 12px;
            ">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-size:0.8rem;color:${isMyLane ? '#fff' : '#aaa'};font-weight:${isMyLane ? '700' : '400'};">
                        ${isMyLane ? '→ ' : ''}${lane.name} ${isMyLane ? '(YOUR LANE)' : ''}
                    </span>
                    <span style="font-size:0.8rem;color:${lane.color};font-weight:700;">${count} vehicle${count !== 1 ? 's' : ''}</span>
                </div>
                <div style="background:#0a0a18;border-radius:4px;height:8px;overflow:hidden;">
                    <div style="width:${pct || 2}%;height:100%;background:${lane.color};border-radius:4px;transition:width 0.5s;"></div>
                </div>
                <div style="font-size:0.65rem;color:#666;margin-top:2px;">${lane.types}</div>
            </div>
        `;
    }).join('');
}
