// telestration/helpers.js - Refactored for PostgreSQL ('pg')

const db = require('./db'); // Import the db module to access the pool

// Function to fetch games currently in 'waiting' status with player counts
async function getWaitingGames() {
    let pool; // Define pool variable in the function scope
    try {
        console.log("Helper: Fetching waiting games...");
        pool = await db.getDbPool(); // Get the initialized pool from db module

        // Use pool.query() - the standard pg method
        // The SQL query itself looks compatible with PostgreSQL
        const result = await pool.query(`
            SELECT
                g.game_code,
                COUNT(p.player_id) as player_count
            FROM Games g
            JOIN Players p ON g.game_id = p.game_id
            WHERE g.status = 'waiting' AND p.is_active = TRUE
            GROUP BY g.game_code, g.created_at -- Include created_at in GROUP BY if ordering by it
            ORDER BY g.created_at DESC;
        `);

        console.log(`Helper: Found ${result.rows.length} waiting games.`);
        // Convert player_count from string (pg default) to number
        return result.rows.map(game => ({
            ...game,
            player_count: parseInt(game.player_count, 10)
        }));
    } catch (err) {
        // Log the error but return an empty array so the broadcast can still happen
        console.error("Helper: Error fetching waiting games:", err);
        // Rethrow if you want startup to fail, but returning empty might be safer
        // throw err;
        return [];
    }
    // No need for finally block to release client, pool.query handles it
}

// Function to broadcast the list of waiting games to all connected sockets
async function broadcastWaitingGames(io) { // No longer needs db passed in
    console.log("Helper: Attempting to broadcast waiting games list...");
    try {
        const waitingGames = await getWaitingGames(); // Call the refactored function
        io.emit('waiting_games_list', waitingGames); // Emit the list to all clients
        console.log(`Helper: Broadcasting updated waiting games list (${waitingGames.length} games).`);
    } catch (err) {
        console.error("Helper: Failed to get or broadcast waiting games list:", err);
        // Emit an empty list on error to potentially clear client-side lists
        io.emit('waiting_games_list', []);
    }
}


// Function to shuffle an array (Fisher-Yates algorithm)
// Used in gameLogic for assigning tasks fairly
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; // Swap elements
    }
    return array;
}

// Export the helper functions
module.exports = {
    getWaitingGames, // Although primarily used internally by broadcastWaitingGames now
    broadcastWaitingGames,
    shuffleArray,
};