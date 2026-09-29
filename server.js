/* ============================================
   SmartLane — Backend Server
   Real-time GPS tracking via WebSockets
   ============================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = 3000;

// Serve static files
app.use(express.static(__dirname));

// Driver page route
app.get('/driver', (req, res) => {
    res.sendFile(__dirname + '/driver.html');
});

// ---- Connected Drivers ----
const drivers = new Map(); // socketId -> { id, type, lat, lng, speed, heading, timestamp }

// ---- WebSocket Logic ----
io.on('connection', (socket) => {
    console.log(`✅ Connected: ${socket.id} (${socket.handshake.query.role || 'unknown'})`);

    const role = socket.handshake.query.role; // 'driver' or 'dashboard'

    // ---- DRIVER events ----
    if (role === 'driver') {

        // Driver registers with vehicle type
        socket.on('driver:register', (data) => {
            const driver = {
                id: socket.id,
                name: data.name || 'Driver',
                type: data.type, // bike, car, van, truck
                lat: null,
                lng: null,
                speed: 0,
                heading: 0,
                timestamp: Date.now(),
            };
            drivers.set(socket.id, driver);
            console.log(`🚗 Driver registered: ${driver.name} (${driver.type})`);

            // Notify all dashboards
            io.emit('vehicle:joined', driver);

            // Send driver their ID
            socket.emit('driver:registered', { id: socket.id });
        });

        // Driver sends GPS update
        socket.on('driver:gps', (data) => {
            const driver = drivers.get(socket.id);
            if (!driver) return;

            driver.lat = data.lat;
            driver.lng = data.lng;
            driver.speed = data.speed || 0;
            driver.heading = data.heading || 0;
            driver.timestamp = Date.now();

            // Broadcast to all dashboards
            io.emit('vehicle:update', {
                id: socket.id,
                type: driver.type,
                name: driver.name,
                lat: data.lat,
                lng: data.lng,
                speed: data.speed || 0,
                heading: data.heading || 0,
            });
        });

        // Driver disconnects
        socket.on('disconnect', () => {
            const driver = drivers.get(socket.id);
            if (driver) {
                console.log(`❌ Driver left: ${driver.name} (${driver.type})`);
                drivers.delete(socket.id);
                io.emit('vehicle:left', { id: socket.id });
            }
        });
    }

    // ---- DASHBOARD events ----
    if (role === 'dashboard') {

        // Send current active drivers to new dashboard
        const activeDrivers = [];
        drivers.forEach((driver) => {
            if (driver.lat !== null) {
                activeDrivers.push(driver);
            }
        });
        socket.emit('vehicles:all', activeDrivers);

        // Dashboard sets zone
        socket.on('zone:set', (data) => {
            // Broadcast zone to all drivers so they can see it
            io.emit('zone:update', data);
            console.log(`📌 Zone set at ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)} (radius: ${data.radius}m)`);
        });

        socket.on('zone:remove', () => {
            io.emit('zone:removed');
            console.log('📌 Zone removed');
        });

        socket.on('disconnect', () => {
            console.log(`📊 Dashboard disconnected: ${socket.id}`);
        });
    }
});

// ---- Get local IP for sharing ----
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// ---- Start Server ----
server.listen(PORT, () => {
    const localIP = getLocalIP();
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════╗');
    console.log('  ║           🚗  SmartLane Server Running           ║');
    console.log('  ╠═══════════════════════════════════════════════════╣');
    console.log(`  ║  Dashboard:  http://localhost:${PORT}               ║`);
    console.log(`  ║  Driver:     http://localhost:${PORT}/driver         ║`);
    console.log('  ╠═══════════════════════════════════════════════════╣');
    console.log('  ║  📱 Share this with drivers (same WiFi):         ║');
    console.log(`  ║  http://${localIP}:${PORT}/driver       ║`);
    console.log('  ╚═══════════════════════════════════════════════════╝');
    console.log('');
});
