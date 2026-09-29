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
    // Initialize driver hub map on switch
    if (mode === 'driver' && typeof initDriverHub === 'function') {
        initDriverHub();
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
    // Lane 1 — Small
    bike:      { emoji: '🏍️', label: 'Bike',       lane: 0, color: '#2e7d32' },
    scooty:    { emoji: '🛵', label: 'Scooty',     lane: 0, color: '#2e7d32' },
    cycle:     { emoji: '🚲', label: 'Bicycle',    lane: 0, color: '#2e7d32' },

    // Lane 2 — Medium
    car:       { emoji: '🚗', label: 'Car',        lane: 1, color: '#1565c0' },
    auto:      { emoji: '🛺', label: 'Auto',       lane: 1, color: '#1565c0' },
    taxi:      { emoji: '🚕', label: 'Taxi',       lane: 1, color: '#1565c0' },

    // Lane 3 — Large
    van:       { emoji: '🚐', label: 'Van/Tempo',  lane: 2, color: '#e65100' },
    ambulance: { emoji: '🚑', label: 'Ambulance',  lane: 2, color: '#e65100' },
    pickup:    { emoji: '🛻', label: 'Pickup',     lane: 2, color: '#e65100' },

    // Lane 4 — Heavy
    truck:     { emoji: '🚛', label: 'Truck',      lane: 3, color: '#b71c1c' },
    bus:       { emoji: '🚌', label: 'Bus',        lane: 3, color: '#b71c1c' },
    tractor:   { emoji: '🚜', label: 'Tractor',    lane: 3, color: '#b71c1c' },
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

// Vehicle speeds by type (Bikes/Cars faster, Trucks slower)
const VEHICLE_SPEED_FACTORS = {
    cycle: 0.9,
    bike: 1.35,
    scooty: 1.1,
    car: 1.25,
    taxi: 1.2,
    auto: 1.05,
    ambulance: 1.45,
    van: 1.0,
    pickup: 1.05,
    bus: 0.85,
    truck: 0.75,
    tractor: 0.65
};

// ---- Vehicle Class ----
class Vehicle {
    constructor(type) {
        this.id = ++vehicleIdCounter;
        this.type = type;
        this.info = VEHICLE_TYPES[type];
        this.roadWidth = roadEl.clientWidth;
        this.roadHeight = roadEl.clientHeight;
        
        // Spawn across road randomly
        this.x = Math.random() * (this.roadWidth - 55) + 10;
        this.y = this.roadHeight + 20 + Math.random() * 40;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;

        const laneWidth = this.roadWidth / 4;
        this.targetX = this.info.lane * laneWidth + (laneWidth / 2) - 19;

        this.detected = false;
        this.sorted = false;
        this.passed = false;
        this.eta = null;
        this.speedFactor = VEHICLE_SPEED_FACTORS[type] || 1.0;
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
        el.innerHTML = `<span>${this.info.emoji}</span><span class="v-tag"></span>`;
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';
        el.title = `${this.info.label} #${this.id}`;
        return el;
    }

    update(allVehicles) {
        if (this.passed) return;

        // Base speed with individual vehicle variation
        let currentSpeed = CONFIG.baseSpeed * CONFIG.speedMultiplier * this.speedFactor;

        // Collision avoidance: check vehicle directly ahead in same lane / close proximity
        for (let other of allVehicles) {
            if (other.id !== this.id && !other.passed) {
                const dy = this.y - other.y;
                const dx = Math.abs(this.x - other.x);
                if (dy > 0 && dy < 65 && dx < 28) {
                    // Slow down to match car ahead
                    currentSpeed = Math.min(currentSpeed, other.vy * 0.9);
                }
            }
        }

        this.vy = currentSpeed;
        this.y -= this.vy;

        // GPS Detection Trigger
        if (!this.detected && this.y <= this.detectionY) {
            this.detected = true;
            this.element.classList.add('detected');
            stats.detected++;
        }

        // Realistic Anti-Overtake & Gap-Acceptance Lane Change
        if (this.detected && !this.sorted) {
            const laneWidth = this.roadWidth / 4;
            const currentLane = Math.floor(this.x / laneWidth);
            const targetLane = this.info.lane;

            // Determine intermediate step (one lane at a time)
            let stepLane = currentLane;
            if (currentLane < targetLane) stepLane = currentLane + 1;
            else if (currentLane > targetLane) stepLane = currentLane - 1;

            const intermediateTargetX = stepLane * laneWidth + (laneWidth / 2) - 19;
            const dx = intermediateTargetX - this.x;

            // Gap Acceptance Check in the adjacent lane before moving:
            // Check if there is another vehicle alongside or too close
            let gapSafe = true;
            let vehicleBlockingAhead = false;

            for (let other of allVehicles) {
                if (other.id !== this.id && !other.passed) {
                    const otherLane = Math.floor(other.x / laneWidth);
                    // Check if other vehicle is in the step lane
                    if (otherLane === stepLane) {
                        const distY = this.y - other.y; // positive: other is ahead, negative: other is behind
                        
                        // Blind-spot / alongside collision hazard (within 55px ahead or 50px behind)
                        if (Math.abs(distY) < 55) {
                            gapSafe = false;
                            if (distY > 0) vehicleBlockingAhead = true;
                        }
                    }
                }
            }

            // If unsafe gap, YIELD gently (slow down to let the blocking vehicle pass ahead, so we merge BEHIND them)
            if (!gapSafe) {
                if (vehicleBlockingAhead) {
                    // Yield: gently brake so lead car pulls ahead, creating a safe gap behind it
                    this.vy *= 0.85;
                }
                // Maintain current lane until clear gap is verified
                this.rotation = 0;
                this.element.classList.remove('indicating-left', 'indicating-right');
            } else if (Math.abs(dx) > 3) {
                // Safe gap confirmed: execute smooth lane shift without aggressive overtaking
                const steerSpeed = Math.min(Math.abs(dx) * 0.04, 2.0) * Math.sign(dx);
                this.x += steerSpeed;
                this.rotation = steerSpeed * 4.0; // realistic steering angle
                
                if (steerSpeed < 0) {
                    this.element.classList.add('indicating-left');
                    this.element.classList.remove('indicating-right');
                } else {
                    this.element.classList.add('indicating-right');
                    this.element.classList.remove('indicating-left');
                }
            } else {
                this.x = intermediateTargetX;
                this.rotation = 0;
                this.element.classList.remove('indicating-left', 'indicating-right');
            }

            const pixelsToZone = this.y - this.sortedY;
            const pixelsPerSecond = Math.max(1, this.vy) * 60;
            this.eta = Math.max(0, Math.round(pixelsToZone / pixelsPerSecond));
            this.element.querySelector('.v-tag').textContent = this.eta + 's';
        }

        // Fully sorted into designated final lane
        if (!this.sorted && this.y <= this.sortedY + 20 && Math.abs(this.x - this.targetX) < 8) {
            this.sorted = true;
            this.rotation = 0;
            this.element.classList.remove('detected', 'indicating-left', 'indicating-right');
            this.element.classList.add('sorted');
            this.element.querySelector('.v-tag').textContent = 'L' + (this.info.lane + 1);
            stats.sorted++;
        }

        // Passed through toll checkpoint
        if (this.y < -80) {
            this.passed = true;
            stats.passed++;
            this.element.remove();
        }

        // Apply smooth 2D transformations (position + steering rotation)
        this.element.style.left = this.x + 'px';
        this.element.style.top = this.y + 'px';
        this.element.style.transform = `rotate(${this.rotation}deg)`;
    }
}

// ---- Game Loop ----
function gameLoop() {
    vehicles.forEach(v => v.update(vehicles));
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
