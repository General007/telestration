// C:\TelestrationsGameApp\server.js
// --- Required Modules ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const db = require('./db'); // Import database module
const { initializeSocketHandlers } = require('./socketHandlers'); // Import socket handler initializer
const helpers = require('./helpers'); // Import helpers (maybe needed for shutdown?)

// --- Constants ---
const PORT = process.env.PORT || 80;

// --- App Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server); // Initialize Socket.IO server

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/', (req, res) => {
    console.log("Main page '/' requested.");
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
    console.log("Admin page '/admin' requested.");
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- Initialize Socket Handlers ---
// Pass the io server instance and the db module to the handler setup function
initializeSocketHandlers(io, db);

// --- Server Startup ---
server.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    try {
        await db.getDbPool(); // Ensure DB pool is ready
        await db.clearDebugGame(); // Clear debug game data
        console.log("DB Pool ready and Debug Game potentially cleared.");
        await helpers.broadcastWaitingGames(io, db); // Broadcast initial list using helper
    } catch (err) {
        console.error("Failed DB init or debug clear on startup:", err);
    }
});

// --- Graceful Shutdown ---
async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    // Stop accepting new connections - server.close handles this implicitly for http/s
    server.close(async (err) => {
        if (err) { console.error('Error closing HTTP server:', err); process.exit(1); }
        console.log('HTTP server closed.');

        // Close DB pool via db module
        await db.closePool();

        // No activeTimers here anymore, managed within socketHandlers/gameLogic potentially
        console.log('Shutdown logic complete (timers managed elsewhere).');
        process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000); // 10 seconds
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));