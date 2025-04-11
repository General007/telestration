// telestration/server.js - Corrected Path Casing for 'Public'

// --- Required Modules ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const db = require('./db'); // Import database module
// No longer need 'mssql'
const { initializeSocketHandlers } = require('./socketHandlers'); // Import socket handler initializer
const helpers = require('./helpers'); // Import helpers

// --- Constants ---
// Use 3000 or 8080 as default, not 80, to avoid permission issues
const PORT = process.env.PORT || 8080; // Changed default from 80

// --- App Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server); // Initialize Socket.IO server

// --- Middleware ---
// Corrected path casing: 'Public' instead of 'public'
app.use(express.static(path.join(__dirname, 'Public')));

// --- Routes ---
app.get('/', (req, res) => {
    console.log("Main page '/' requested.");
    // Corrected path casing: 'Public' instead of 'public'
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});
app.get('/admin', (req, res) => {
    console.log("Admin page '/admin' requested.");
     // Corrected path casing: 'Public' instead of 'public'
    res.sendFile(path.join(__dirname, 'Public', 'admin.html'));
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
        // Call broadcastWaitingGames without db, as helpers now requires it directly
        await helpers.broadcastWaitingGames(io);
    } catch (err) {
        console.error("Failed DB init or debug clear on startup:", err);
    }
});

// --- Graceful Shutdown ---
async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(async (err) => {
        if (err) { console.error('Error closing HTTP server:', err); process.exit(1); }
        console.log('HTTP server closed.');
        await db.closePool();
        console.log('Shutdown logic complete.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000); // 10 seconds
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));