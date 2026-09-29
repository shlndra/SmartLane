/* ============================================
   SmartLane — Demo Mode + Mode Switching
   ============================================ */

// ---- Current Mode ----
let currentMode = 'demo';

function switchMode(mode) {
    currentMode = mode;

    // Toggle mode content visibility
    document.querySelectorAll('.mode-content').forEach(el => el.classList.remove('active'));
    document.getElementById(mode + '-mode').classList.add('active');

    // Toggle mode button active state
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-' + mode + '-mode').classList.add('active');

    // Initialize live mode map on first switch
    if (mode === 'live' && typeof initLiveMode === 'function') {
        initLiveMode();
    }
}

// ---- Clock ----
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();


/* ============================================
   DEMO MODE — Simulation Logic
   ============================================ */

const CONFIG = {
    spawnInterval: 2000,
    baseSpeed: 1.2,
    speedMultiplier: 2,
    detectionLinePercent: 0.45,
    sortedZonePercent: 0.20,
    maxVehiclesOnRoad: 20,
};

const VEHICLE_TYPES = {
    bike:  { emoji: '🏍️', label: 'Bike',  lane: 0, color: '#2e7d32' },
    car:   { emoji: '🚗', label: 'Car',   lane: 1, color: '#1565c0' },
    van:   { emoji: '🚐', label: 'Van',   lane: 2, color: '#e65100' },
    truck: { emoji: '🚛', label: 'Truck', lane: 3, color: '#b71c1c' },
};

const TYPE_KEYS = Object.keys(VEHICLE_TYPES);

let vehicles = [];
let vehicleIdCounter = 0;
let autoSpawning = false;
let autoSpawnTimer = null;
let animFrameId = null;
let stats = { total: 0, detected: 0, sorted: 0, passed: 0 };
let typeCounts = { bike: 0, car: 0, van: 0, truck: 0 };

const roadEl = document.getElementById('road');
const vehicleListEl = document.getElementById('vehicle-list');

// ---- Vehicle Class ----
class Vehicle {
    constructor(type) {
        this.id = ++vehicleIdCounter;
        this.type = type;
        this.info = VEHICLE_TYPES[type];
        this.roadWidth = roadEl.clientWidth;
        this.roadHeight = roadEl.clientHeight;
        this.x = Math.random() * (this.roadWidth - 50) + 5;
        this.y = this.roadHeight + 10;

        const laneWidth = this.roadWidth / 4;
        this.targetX = this.info.lane * laneWidth + (laneWidth / 2) - 20;

        this.detected = false;
        this.sorted = false;
        this.passed = false;
        this.eta = null;
        this.detectionY = this.roadHeight * CONFIG.detectionLinePercent;
        this.sortedY = this.roadHeight * CONFIG.sortedZonePercent;

        this.element = this.createElement();
        roadEl.appendChild(this.element);

        stats.total++;
        typeCounts[type]++;
    }

    createElement() {
        const el = document.createElement('div');
        el.className = `vehicle type-${this.type}`;
        el.innerHTML = `<span>${this.info.emoji}</span><span class="v-eta"></span>`;
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';
        el.title = `${this.info.label} #${this.id}`;
        return el;
    }

    update() {
        if (this.passed) return;

        const speed = CONFIG.baseSpeed * CONFIG.speedMultiplier;
        this.y -= speed;

        if (!this.detected && this.y <= this.detectionY) {
            this.detected = true;
            this.element.classList.add('detected');
            stats.detected++;
            this.element.style.left = this.targetX + 'px';
        }

        if (this.detected && !this.sorted) {
            const pixelsToZone = this.y - this.sortedY;
            const pixelsPerSecond = speed * 60;
            this.eta = Math.max(0, Math.round(pixelsToZone / pixelsPerSecond));
            this.element.querySelector('.v-eta').textContent = this.eta + 's';
        }

        if (!this.sorted && this.y <= this.sortedY + 40) {
            this.sorted = true;
            this.element.classList.remove('detected');
            this.element.classList.add('sorted');
            this.element.querySelector('.v-eta').textContent = '✓';
            stats.sorted++;
        }

        if (this.y < -60) {
            this.passed = true;
            stats.passed++;
            this.element.remove();
        }

        this.element.style.top = this.y + 'px';
    }
}

// ---- Game Loop ----
function gameLoop() {
    vehicles.forEach(v => v.update());
    vehicles = vehicles.filter(v => !v.passed);
    updateDemoDashboard();
    animFrameId = requestAnimationFrame(gameLoop);
}

function updateDemoDashboard() {
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-detected').textContent = stats.detected;
    document.getElementById('stat-sorted').textContent = stats.sorted;
    document.getElementById('stat-passed').textContent = stats.passed;

    document.getElementById('count-bike').textContent = typeCounts.bike;
    document.getElementById('count-car').textContent = typeCounts.car;
    document.getElementById('count-van').textContent = typeCounts.van;
    document.getElementById('count-truck').textContent = typeCounts.truck;

    const approaching = vehicles.filter(v => v.detected && !v.passed);
    if (approaching.length === 0) {
        vehicleListEl.innerHTML = '<p class="empty-msg">No vehicles detected yet...</p>';
    } else {
        vehicleListEl.innerHTML = approaching
            .sort((a, b) => (a.eta || 99) - (b.eta || 99))
            .map(v => `
                <div class="vl-item ${v.detected ? 'detected' : ''}">
                    <span class="vl-emoji">${v.info.emoji}</span>
                    <div class="vl-info">
                        <div class="vl-type">${v.info.label} #${v.id}</div>
                        <div class="vl-lane">→ Lane ${v.info.lane + 1}</div>
                    </div>
                    <span class="vl-eta">${v.sorted ? '✅' : v.eta + 's'}</span>
                </div>
            `).join('');
    }
}

// ---- Controls ----
function addVehicle(type) {
    if (vehicles.filter(v => !v.passed).length >= CONFIG.maxVehiclesOnRoad) return;
    vehicles.push(new Vehicle(type));
}

function addRandomVehicle() {
    const type = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
    addVehicle(type);
}

function toggleAutoSpawn() {
    autoSpawning = !autoSpawning;
    const btn = document.getElementById('btn-auto');
    if (autoSpawning) {
        btn.textContent = '⏸ Stop';
        btn.classList.add('active');
        autoSpawnTimer = setInterval(addRandomVehicle, CONFIG.spawnInterval);
    } else {
        btn.textContent = '▶ Auto Spawn';
        btn.classList.remove('active');
        clearInterval(autoSpawnTimer);
    }
}

function updateSpeed(val) {
    CONFIG.speedMultiplier = parseInt(val);
    document.getElementById('speed-label').textContent = val + 'x';
}

function resetSimulation() {
    if (autoSpawning) toggleAutoSpawn();
    vehicles.forEach(v => v.element.remove());
    vehicles = [];
    vehicleIdCounter = 0;
    stats = { total: 0, detected: 0, sorted: 0, passed: 0 };
    typeCounts = { bike: 0, car: 0, van: 0, truck: 0 };
    updateDemoDashboard();
}

// ---- Init Demo ----
window.addEventListener('DOMContentLoaded', () => {
    animFrameId = requestAnimationFrame(gameLoop);
    toggleAutoSpawn();
});

window.addEventListener('resize', () => {
    vehicles.forEach(v => {
        v.roadWidth = roadEl.clientWidth;
        v.roadHeight = roadEl.clientHeight;
        const laneWidth = v.roadWidth / 4;
        v.targetX = v.info.lane * laneWidth + (laneWidth / 2) - 20;
        v.detectionY = v.roadHeight * CONFIG.detectionLinePercent;
        v.sortedY = v.roadHeight * CONFIG.sortedZonePercent;
        if (v.detected) v.element.style.left = v.targetX + 'px';
    });
});
