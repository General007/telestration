// C:\TelestrationsGameApp\helpers.js

function generateGameCode() {
    // Simple random code generator
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

async function getWaitingGames(db) { // Accept db instance
    // Fetches games currently in 'waiting' status
    try {
        const pool = await db.getDbPool(); // Use passed db instance
        const result = await pool.request()
            .query(`SELECT g.game_code, g.game_id, COUNT(p.player_id) as player_count
                    FROM Games g
                    LEFT JOIN Players p ON g.game_id = p.game_id AND p.is_active = 1
                    WHERE g.status = 'waiting'
                    GROUP BY g.game_code, g.game_id, g.created_at -- Include created_at in GROUP BY if used in ORDER BY
                    ORDER BY g.created_at DESC;`);
        return result.recordset;
    } catch (err) {
        console.error("Helper: Error fetching waiting games:", err);
        return [];
    }
}

async function broadcastWaitingGames(io, db) { // Accept io and db instances
    // Sends the current list of waiting games to all connected sockets
    try {
        // Pass db to getWaitingGames
        const waitingGames = await getWaitingGames(db);
        console.log(`Helper: Broadcasting updated waiting games list (${waitingGames.length} games).`);
        io.emit('active_games_list', waitingGames); // Use passed io instance
    } catch(err) {
         console.error("Helper: Error broadcasting waiting games:", err);
    }
}


module.exports = {
    generateGameCode,
    getWaitingGames,
    broadcastWaitingGames
};