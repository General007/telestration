// telestration/db.js - Final Version with PostgreSQL and Environment Variables

// Load environment variables from .env file for local development
require('dotenv').config();

const { Pool } = require('pg');

// --- Configuration ---
// Read configuration strictly from environment variables
const dbConfig = {
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    port: parseInt(process.env.PGPORT || '5432', 10),
    // Optional Pool settings from environment or defaults
    max: process.env.PGPOOLMAX ? parseInt(process.env.PGPOOLMAX, 10) : 10,
    idleTimeoutMillis: process.env.PGPOOLIDLETIMEOUT ? parseInt(process.env.PGPOOLIDLETIMEOUT, 10) : 30000,
    connectionTimeoutMillis: process.env.PGPOOLCONNTIMEOUT ? parseInt(process.env.PGPOOLCONNTIMEOUT, 10) : 2000,
    // Basic SSL configuration from environment (adjust as needed for specific certs)
    ssl: process.env.PGSSLMODE && process.env.PGSSLMODE.toLowerCase() !== 'disable'
      ? { rejectUnauthorized: !(process.env.PGSSLMODE.toLowerCase() === 'no-verify' || process.env.PGSSLMODE.toLowerCase() === 'allow') }
      : false,
};
// --- End Configuration ---

let pool = null;

async function getDbPool() {
    if (!pool) {
        console.log('Creating new PostgreSQL connection pool using environment configuration...');
        // Validate essential config loaded from environment
        if (!dbConfig.user || !dbConfig.password || !dbConfig.host || !dbConfig.database) {
            const missing = ['PGUSER', 'PGPASSWORD', 'PGHOST', 'PGDATABASE'].filter(v => !process.env[v]);
            console.error(`FATAL ERROR: Missing required database configuration in environment variables: ${missing.join(', ')}.`);
            process.exit(1); // Exit if essential config is missing
        }

        pool = new Pool(dbConfig);

        pool.on('error', (err, client) => {
            console.error('PostgreSQL Pool Error:', err);
        });

        try {
            const client = await pool.connect();
            console.log('PostgreSQL Pool Connected & Test Query OK.');
            client.release();
        } catch (err) {
            console.error('PostgreSQL Initial Pool Connection Failed:', err);
            pool = null;
            throw err;
        }
    }
    return pool;
}

async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('PostgreSQL Pool closed.');
    }
}

// --- Database Operation Functions (No changes needed from Step 2.2 refactor) ---

async function getActivePlayers(gameId) {
    const db = await getDbPool();
    const result = await db.query(
        'SELECT player_id, player_name, socket_id FROM Players WHERE game_id = $1 AND is_active = TRUE;',
        [gameId]
    );
    return result.rows;
}

async function getGameSettings(gameId = null, gameCode = null) {
    if (!gameId && !gameCode) return null;
    const db = await getDbPool();
    const queryText = `
        SELECT game_id, game_code, status, current_round, current_step_type,
               num_rounds, prompt_time_limit_sec, draw_time_limit_sec,
               guess_time_limit_sec, game_master_player_id
        FROM Games WHERE ${gameId ? 'game_id = $1' : 'game_code = $1'};`;
    const queryParams = [gameId || gameCode];
    const result = await db.query(queryText, queryParams);
    return result.rows.length > 0 ? result.rows[0] : null;
}

async function createGameAndPlayer(gameCode, playerName, socketId, numRounds, promptTime, drawTime, guessTime) {
    const db = await getDbPool();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const gameResult = await client.query(
            `INSERT INTO Games (game_code, status, num_rounds, prompt_time_limit_sec, draw_time_limit_sec, guess_time_limit_sec)
             VALUES ($1, 'waiting', $2, $3, $4, $5) RETURNING game_id;`,
            [gameCode, numRounds, promptTime, drawTime, guessTime]
        );
        const gameId = gameResult.rows[0].game_id;

        const playerResult = await client.query(
            `INSERT INTO Players (game_id, player_name, socket_id, is_active)
             VALUES ($1, $2, $3, TRUE) RETURNING player_id;`,
            [gameId, playerName, socketId]
        );
        const playerId = playerResult.rows[0].player_id;

        await client.query(
            'UPDATE Games SET game_master_player_id = $1 WHERE game_id = $2;',
            [playerId, gameId]
        );
        await client.query('COMMIT');
        console.log(`DB: Game ${gameCode} (ID: ${gameId}) created. GM Player ID: ${playerId}.`);
        return { gameId, playerId };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("DB Create Game & Player Transaction Error:", err);
        throw err;
    } finally {
        client.release();
    }
}

async function addPlayerToGame(gameId, playerName, socketId) {
    const db = await getDbPool();
    const nameCheck = await db.query(
        'SELECT 1 FROM Players WHERE game_id = $1 AND player_name = $2 AND is_active = TRUE',
        [gameId, playerName]
    );
    if (nameCheck.rows.length > 0) {
        throw new Error('Name already taken in this game.');
    }
    const playerResult = await db.query(
        `INSERT INTO Players (game_id, player_name, socket_id, is_active)
         VALUES ($1, $2, $3, TRUE) RETURNING player_id;`,
        [gameId, playerName, socketId]
    );
    return playerResult.rows[0].player_id;
}

async function reactivatePlayer(playerId, socketId) {
    const db = await getDbPool();
    await db.query(
        'UPDATE Players SET is_active = TRUE, socket_id = $1 WHERE player_id = $2;',
        [socketId, playerId]
    );
}

async function findInactivePlayer(gameId, playerName) {
    const db = await getDbPool();
    const result = await db.query(
        'SELECT player_id, is_active FROM Players WHERE game_id = $1 AND player_name = $2',
        [gameId, playerName]
    );
    return (result.rows.length > 0 && !result.rows[0].is_active) ? result.rows[0].player_id : null;
}

async function findPlayerDataBySocket(socketId) {
    const db = await getDbPool();
    const result = await db.query(
        `SELECT p.player_id, p.game_id, g.game_code, g.status
         FROM Players p JOIN Games g ON p.game_id = g.game_id
         WHERE p.socket_id = $1 AND p.is_active = TRUE;`,
        [socketId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
}

async function deactivatePlayer(playerId) {
    const db = await getDbPool();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'UPDATE Players SET is_active = FALSE, socket_id = NULL WHERE player_id = $1;',
            [playerId]
        );
        await client.query(
            'UPDATE Threads SET is_active = FALSE WHERE original_player_id = $1;',
            [playerId]
        );
        await client.query('COMMIT');
        console.log(`DB: Player ${playerId} and their originating threads marked inactive.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`DB Error deactivating player ${playerId}:`, err);
        throw err;
    } finally {
        client.release();
    }
}

async function createThreadsForPlayers(gameId, players) {
    const db = await getDbPool();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        for (const player of players) {
            await client.query(
                'INSERT INTO Threads (game_id, original_player_id, is_active) VALUES ($1, $2, TRUE);',
                [gameId, player.player_id]
            );
        }
        await client.query('COMMIT');
        console.log(`DB: Created threads for ${players.length} players in game ${gameId}.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Create Threads Transaction Error:", err);
        throw err;
    } finally {
        client.release();
    }
}

async function getActiveThreadIds(gameId) {
    const db = await getDbPool();
    const result = await db.query(
        'SELECT thread_id FROM Threads WHERE game_id = $1 AND is_active = TRUE;',
        [gameId]
    );
    return result.rows.map(t => t.thread_id);
}

async function getThreadIdForPlayerPrompt(gameCode, playerId) {
    const db = await getDbPool();
    const result = await db.query(
        `SELECT t.thread_id FROM Threads t JOIN Games g ON t.game_id = g.game_id
         WHERE g.game_code = $1 AND t.original_player_id = $2 AND t.is_active = TRUE;`,
        [gameCode, playerId]
    );
    return result.rows.length > 0 ? result.rows[0].thread_id : null;
}

async function saveStep(threadId, playerId, stepNumber, stepType, textContent, imageContent) {
    const db = await getDbPool();
    await db.query(
        `INSERT INTO Steps (thread_id, player_id, step_number, step_type, text_content, image_content)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [threadId, playerId, stepNumber, stepType, textContent, imageContent]
    );
}

async function countSubmittedSteps(gameId, stepNumber, stepType) {
    const db = await getDbPool();
    const result = await db.query(
        `SELECT COUNT(s.step_id) as submission_count
         FROM Steps s JOIN Threads t ON s.thread_id = t.thread_id
         WHERE t.game_id = $1 AND s.step_number = $2 AND s.step_type = $3 AND t.is_active = TRUE;`,
        [gameId, stepNumber, stepType]
    );
    return parseInt(result.rows[0].submission_count, 10);
}

async function setGameMaster(gameId, playerId) {
    const db = await getDbPool();
    await db.query(
        'UPDATE Games SET game_master_player_id = $1 WHERE game_id = $2;',
        [playerId, gameId]
    );
    console.log(`DB: Set P:<span class="math-inline">\{playerId\} as GM for G\:</span>{gameId}.`);
}

async function getPreviousStepDataForAssignment(gameId, previousStepNumber, contentTypeColumn) {
    const db = await getDbPool();
    const queryText = `
        SELECT s.step_id, s.thread_id, s.${contentTypeColumn} as content,
               s.player_id as previous_player_id, t.original_player_id
        FROM Steps s JOIN Threads t ON s.thread_id = t.thread_id
        WHERE t.game_id = $1 AND s.step_number = $2 AND t.is_active = TRUE;`;
    const result = await db.query(queryText, [gameId, previousStepNumber]);
    return result.rows;
}

async function updateGameStatus(gameId, status, currentStepType = null, currentRound = null) {
    const db = await getDbPool();
    let setClauses = ['status = $2'];
    let queryParams = [gameId, status];
    let paramIndex = 3;

    setClauses.push(`current_step_type = $${paramIndex++}`);
    queryParams.push(currentStepType);

    if (currentRound !== null) {
        setClauses.push(`current_round = $${paramIndex++}`);
        queryParams.push(currentRound);
    }

    const queryText = `UPDATE Games SET ${setClauses.join(', ')} WHERE game_id = $1;`;
    await db.query(queryText, queryParams);
    console.log(`DB: G:${gameId} status updated to <span class="math-inline">\{status\}, Round\:</span>{currentRound ?? 'N/A'}, StepType:${currentStepType ?? 'N/A'}`);
}

async function getRevealData(gameId) {
    const db = await getDbPool();
    try {
        console.log(`DB: Fetching reveal data for active threads in Game ID: ${gameId}`);
        const result = await db.query(
            `SELECT
                t.thread_id, t.original_player_id, op.player_name as original_player_name,
                s.step_id, s.step_number, s.step_type, s.text_content, s.image_content,
                s.player_id as step_player_id, sp.player_name as step_player_name,
                sp.is_active as step_player_is_active
            FROM Threads t
            JOIN Steps s ON t.thread_id = s.thread_id
            JOIN Players op ON t.original_player_id = op.player_id
            JOIN Players sp ON s.player_id = sp.player_id
            WHERE t.game_id = $1 AND t.is_active = TRUE
            ORDER BY t.thread_id, s.step_number;`,
            [gameId]
        );

        console.log(`DB: Found ${result.rows.length} steps for reveal.`);
        const threadsData = {};
        for (const row of result.rows) {
            const threadId = row.thread_id;
            if (!threadsData[threadId]) {
                threadsData[threadId] = {
                    threadId: threadId,
                    originalPlayerId: row.original_player_id,
                    originalPlayerName: row.original_player_name,
                    steps: []
                };
            }

            let content = row.text_content;
            if (row.step_type === 'drawing' && Buffer.isBuffer(row.image_content)) {
                content = `data:image/png;base64,${row.image_content.toString('base64')}`;
            } else if (row.step_type === 'drawing' && row.image_content == null) {
                content = "[Error: Drawing data missing]";
                console.warn(`DB: Missing image_content for drawing step ${row.step_id} in thread ${threadId}`);
            }

            threadsData[threadId].steps.push({
                stepNumber: row.step_number,
                stepType: row.step_type,
                content: content || "",
                playerId: row.step_player_id,
                playerName: row.step_player_name,
                playerIsActive: row.step_player_is_active
            });
        }
        return Object.values(threadsData);
    } catch (err) {
        console.error(`DB: Error fetching reveal data for Game ID ${gameId}:`, err);
        return [];
    }
}

async function getRandomPrompt() {
    const db = await getDbPool();
    const result = await db.query('SELECT prompt_text FROM RandomPrompts ORDER BY RANDOM() LIMIT 1;');
    return result.rows.length > 0 ? result.rows[0].prompt_text : 'A default random prompt';
}

async function getSocketId(playerId) {
    const db = await getDbPool();
    const result = await db.query(
        'SELECT socket_id FROM Players WHERE player_id = $1 AND is_active = TRUE;',
        [playerId]
    );
    return result.rows.length > 0 ? result.rows[0].socket_id : null;
}

async function clearDebugGame() {
    const DEBUG_GAME_CODE = 'DEBUG';
    console.log(`Attempting to clear previous data for debug game: ${DEBUG_GAME_CODE}`);
    const db = await getDbPool();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const gameResult = await client.query('SELECT game_id FROM Games WHERE game_code = $1;', [DEBUG_GAME_CODE]);

        if (gameResult.rows.length > 0) {
            const gameId = gameResult.rows[0].game_id;
            console.log(`Found previous debug game ID: ${gameId}. Deleting...`);
            await client.query('DELETE FROM Games WHERE game_id = $1;', [gameId]);
            console.log(`Debug game ${DEBUG_GAME_CODE} (ID: ${gameId}) deleted.`);
        } else {
            console.log(`No previous debug game ${DEBUG_GAME_CODE} found to clear.`);
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error clearing debug game ${DEBUG_GAME_CODE}:`, err);
    } finally {
        client.release();
    }
}

async function deactivateThread(threadId) {
    try {
        console.log(`DB: Deactivating Thread ID: ${threadId}`);
        const db = await getDbPool();
        await db.query(
            'UPDATE Threads SET is_active = FALSE WHERE thread_id = $1;',
            [threadId]
        );
        console.log(`DB: Thread ID ${threadId} marked inactive.`);
    } catch (err) {
         console.error(`DB: Error deactivating thread ${threadId}:`, err);
    }
}

async function getSubmittedStepsForPhase(gameId, stepNumber) {
    try {
        const db = await getDbPool();
        const result = await db.query(
            `SELECT s.player_id, s.thread_id
             FROM Steps s JOIN Threads t ON s.thread_id = t.thread_id
             WHERE t.game_id = $1 AND s.step_number = $2 AND t.is_active = TRUE;`,
             [gameId, stepNumber]
         );
        return result.rows;
    } catch (err) {
        console.error(`DB: Error getting submitted steps for G:<span class="math-inline">\{gameId\}, Step\:</span>{stepNumber}:`, err);
        return [];
    }
}

// Export all functions
module.exports = {
    getDbPool,
    closePool,
    clearDebugGame,
    getActivePlayers,
    getGameSettings,
    createGameAndPlayer,
    addPlayerToGame,
    reactivatePlayer,
    findInactivePlayer,
    findPlayerDataBySocket,
    deactivatePlayer,
    createThreadsForPlayers,
    getActiveThreadIds,
    getThreadIdForPlayerPrompt,
    saveStep,
    countSubmittedSteps,
    getPreviousStepDataForAssignment,
    updateGameStatus,
    getRevealData,
    getRandomPrompt,
    getSocketId,
    deactivateThread,
    setGameMaster,
    getSubmittedStepsForPhase,
};