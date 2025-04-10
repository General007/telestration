// C:\TelestrationsGameApp\socketHandlers.js

const gameLogic = require('./gameLogic'); // Import game logic functions
const helpers = require('./helpers');   // Import helper functions
// Note: db is passed into the initialize function, no need to require it here directly

// --- State specific to socket handling ---
let activeTimers = {}; // Moved from server.js { gameCode: { timerId: <timeoutId>, phase: '...' } }
let connectedSockets = new Set(); // Moved from server.js

// Add near top of socketHandlers.js
let gameAssignments = {}; // Stores current assignments { gameCode: { phase: 'drawing'/'guessing', assignments: { threadId: playerId, ... } } }

function initializeSocketHandlers(io, db) { // Accept io and db instances

    // --- Main Connection Handler ---
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        connectedSockets.add(socket.id);

        // Send current waiting games list to the newly connected client
        // Pass db instance to the helper function
        helpers.getWaitingGames(db).then(games => {
            socket.emit('active_games_list', games);
        }).catch(err => console.error(`Error sending initial game list to ${socket.id}:`, err));


        socket.on('disconnect', async () => {
            console.log(`User disconnected: ${socket.id}`);
            connectedSockets.delete(socket.id);
            try {
                const playerData = await db.findPlayerDataBySocket(socket.id);

                if (playerData) {
                    const { player_id, game_id, game_code, status } = playerData;

                     // Deactivate player first
                    try {
                         await db.deactivatePlayer(player_id);
                         console.log(`Player ${player_id} marked as inactive in game ${game_code}`);
                     } catch (deactivateErr) {
                          console.error(` -> ERROR during db.deactivatePlayer for PlayerID ${player_id}:`, deactivateErr);
                          return; // Stop processing if deactivate fails
                     }

                    // Broadcast updated waiting list if player leaves a waiting game (with delay)
                    if(status === 'waiting' && game_code) {
                        console.log(` -> Player ${player_id} left waiting game ${game_code}. Delaying broadcast...`);
                        setTimeout(async () => {
                             console.log(` -> Executing delayed broadcast for ${game_code} after disconnect.`);
                             // Pass io and db to helper
                             await helpers.broadcastWaitingGames(io, db);
                        }, 1000); // Delay 1 second
                    }

                    // Check game state *after* delay if possible, or just get players now
                    const gameExistsCheck = await db.getGameSettings(game_id);
                    if (gameExistsCheck && game_code) {
                        const playersInGame = await db.getActivePlayers(game_id);
                        if (playersInGame.length > 0) {
                             io.to(game_code).emit('player_left', { playerId: player_id, players: playersInGame });
                        } else {
                            console.log(`Last player left game ${game_code}.`);
                        }
                        // Check phase completion only if game exists and wasn't waiting/finished/revealing
                         if (status !== 'waiting' && status !== 'revealing' && status !== 'finished') {
                             // Pass io, db, activeTimers to gameLogic function
                             await gameLogic.checkPhaseCompletion(io, db, activeTimers, gameAssignments, game_code, game_id);
                         }
                    } else {
                         console.log(` -> Game ${game_code} (ID:${game_id}) not found after player ${player_id} disconnect. Skipping further updates.`);
                    }

                } else {
                    console.log(` -> No active player data found for disconnected socket: ${socket.id}`);
                }
            } catch (err) {
                console.error('Error during disconnect handling sequence:', err);
            }
        }); // End socket.on('disconnect')

        // --- Socket Event Handlers ---

        // Handles game creation (Admin IS the GM)
        socket.on('create_game', async (data) => {
            // Default config values should ideally be managed centrally, maybe passed from server.js
            const MAX_ROUNDS_DEFAULT = 2;
            const PROMPT_TIME_DEFAULT = 60;
            const DRAW_TIME_DEFAULT = 300;
            const GUESS_TIME_DEFAULT = 120;
            const DEBUG_GAME_CODE = 'DEBUG'; // Should match constant in server.js
            const DEBUG_MODE = true; // Should match constant in server.js

            const playerName = data.playerName?.trim() || 'Admin';
            const requestedGameCode = data.gameCode?.trim().toUpperCase();
            let gameCode;
            if (requestedGameCode) { gameCode = requestedGameCode; }
            else if (DEBUG_MODE) { gameCode = DEBUG_GAME_CODE; }
            else { gameCode = helpers.generateGameCode(); } // Use helper
            const isDebugOrSpecific = (gameCode === DEBUG_GAME_CODE || requestedGameCode);

            const numRounds = parseInt(data.numRounds, 10) || MAX_ROUNDS_DEFAULT;
            const promptTime = parseInt(data.promptTime, 10) || PROMPT_TIME_DEFAULT;
            const drawTime = parseInt(data.drawTime, 10) || DRAW_TIME_DEFAULT;
            const guessTime = parseInt(data.guessTime, 10) || GUESS_TIME_DEFAULT;

            console.log(`Attempting to create game: ${gameCode} requested by ${playerName} with config: R=${numRounds}, T(P/D/G)=${promptTime}/${drawTime}/${guessTime}`);

            try {
                console.log(`Checking DB for existing game code: ${gameCode}`);
                if (isDebugOrSpecific) {
                    const existingGame = await db.getGameSettings(null, gameCode);
                    if (existingGame) {
                        console.log(`Attempted to create game ${gameCode}, but found existing game ID: ${existingGame.game_id}.`);
                        return socket.emit('error_message', `Game code '${gameCode}' already exists. Try joining or use a different code.`);
                    } else {
                         console.log(`Game code ${gameCode} not found in DB. Proceeding with creation.`);
                    }
                }

                // Call DB function (ensure db.js has the version that adds player/GM)
                const { gameId, playerId } = await db.createGameAndPlayer(
                    gameCode, playerName, socket.id,
                    numRounds, promptTime, drawTime, guessTime
                );

                socket.join(gameCode); // Creator joins the room

                socket.emit('game_created', {
                    gameCode, gameId, playerId, playerName,
                    isGameMaster: true,
                    players: [{ player_id: playerId, player_name: playerName }]
                });
                console.log(`Game ${gameCode} created by GM ${playerName} (PlayerID: ${playerId}) with custom config.`);

                console.log(` -> Game ${gameCode} created successfully. Broadcasting game list...`);
                await helpers.broadcastWaitingGames(io, db); // Pass io, db
                console.log(` -> Broadcast complete after game creation.`);

            } catch (err) {
                console.error(`Error creating game ${gameCode}:`, err);
                if (err.message && err.message.includes('UNIQUE KEY')) {
                     socket.emit('error_message', 'Failed to create game (code conflict). Please try again.');
                } else {
                    socket.emit('error_message', 'Failed to create game. Database error.');
                }
            }
        }); // End socket.on('create_game')

        // Handles players joining a game
        socket.on('join_game', async (data) => {
            const gameCode = data.gameCode?.trim().toUpperCase();
            const playerName = data.playerName?.trim();

            if (!gameCode || !playerName) {
                console.warn(`Join attempt failed: Missing gameCode or playerName.`);
                return socket.emit('error_message', 'Please provide game code and name.');
            }

            console.log(`Player ${playerName} attempting to join game ${gameCode}`);

            try {
                const game = await db.getGameSettings(null, gameCode);

                if (!game) {
                    console.log(`Join attempt failed: Game ${gameCode} not found.`);
                    await helpers.broadcastWaitingGames(io, db);
                    return socket.emit('error_message', 'Game not found. It might have started or ended.');
                }

                if (game.status !== 'waiting') {
                     console.log(`Join attempt failed: Game ${gameCode} is in status ${game.status}.`);
                     await helpers.broadcastWaitingGames(io, db);
                     return socket.emit('error_message', 'Game has already started or finished.');
                }

                let playerId = null;
                let joined = false;
                let isRejoin = false;

                const inactivePlayerId = await db.findInactivePlayer(game.game_id, playerName);
                if (inactivePlayerId) {
                    await db.reactivatePlayer(inactivePlayerId, socket.id);
                    playerId = inactivePlayerId;
                    joined = true;
                    isRejoin = true;
                    console.log(`Player ${playerName} (ID: ${playerId}) reactivated/rejoined WAITING game ${gameCode}`);
                } else {
                    // Standard join
                    try {
                        const currentPlayers = await db.getActivePlayers(game.game_id);
                        let isFirstPlayer = (game.game_master_player_id === null);

                        if (isFirstPlayer) { console.log(`First player (${playerName}) joining game ${gameCode}. Will be set as GM.`); }

                        playerId = await db.addPlayerToGame(game.game_id, playerName, socket.id);
                        joined = true;
                        console.log(`Player ${playerName} (ID: ${playerId}) added to WAITING game ${gameCode}`);

                        if (isFirstPlayer) {
                             await db.setGameMaster(game.game_id, playerId);
                             console.log(`Player ${playerId} (${playerName}) set as Game Master for game ${game.game_id}`);
                        }
                        console.log(` -> New player joined ${gameCode}. Broadcasting game list...`);
                        await helpers.broadcastWaitingGames(io, db);
                        console.log(` -> Broadcast complete after new player join.`);
                    } catch (err) {
                        if (err.message && err.message.includes('Name already taken')) {
                             return socket.emit('error_message', `Name '${playerName}' is already taken in this game.`);
                        } else {
                            console.error(`DB Error adding player ${playerName} to game ${gameCode}:`, err);
                            return socket.emit('error_message', err.message || 'Failed to add player.');
                        }
                    }
                }

                if (joined) {
                    socket.join(gameCode);
                    const updatedGame = await db.getGameSettings(game.game_id);
                    const playersInGame = await db.getActivePlayers(game.game_id);
                    const isGameMaster = updatedGame.game_master_player_id === playerId;

                    socket.emit('game_joined', {
                        gameCode, gameId: updatedGame.game_id, playerId, playerName,
                        isGameMaster, players: playersInGame, gameStatus: updatedGame.status
                    });

                    // Notify others
                    socket.to(gameCode).emit('player_joined', { players: playersInGame });
                    console.log(`Notified room ${gameCode} that player ${playerName} ${isRejoin ? 'rejoined' : 'joined'}.`);
                }
            } catch (err) {
                console.error(`Error processing join request for game ${gameCode}:`, err);
                socket.emit('error_message', 'Failed to join game (server error).');
            }
        }); // End socket.on('join_game')


        // Request a random prompt
        socket.on('get_random_prompt', async () => {
            try {
                const prompt = await db.getRandomPrompt();
                socket.emit('random_prompt_result', { prompt });
            } catch (err) {
                console.error("Error getting random prompt:", err);
                socket.emit('random_prompt_result', { prompt: 'Error fetching prompt' });
            }
        });

	// MODIFY start_game handler in socketHandlers.js
	socket.on('start_game', async (data) => {
		const { gameCode, playerId } = data;
		try {
			const game = await db.getGameSettings(null, gameCode);
			// --- Keep existing checks ---
			if (!game) return socket.emit('error_message', 'Game not found.');
			if (playerId !== game.game_master_player_id) return socket.emit('error_message', 'Only the Game Master can start.');
			if (game.status !== 'waiting') return socket.emit('error_message', 'Game already started/finished.');
			const players = await db.getActivePlayers(game.game_id);
			if (players.length < 2) return socket.emit('error_message', 'Need at least 2 players.');
			// --- End checks ---

			// *** Change: Still go to 'prompting', round 0 first ***
			await db.updateGameStatus(game.game_id, 'prompting', 'prompt', 0); // Start at round 0 for prompting
			// *** Change: Create threads BEFORE prompting ***
			// This ensures a thread exists even if a player fails the first prompt
			await db.createThreadsForPlayers(game.game_id, players);
			console.log(` -> Created initial threads for ${players.length} players.`);

			io.to(gameCode).emit('game_started', { players });
			io.to(gameCode).emit('task_prompt');
			// Use gameLogic's timer function - still for prompting phase
			gameLogic.startPhaseTimer(io, activeTimers, db, gameCode, game.game_id, 'prompting', game.prompt_time_limit_sec);

			console.log(`Game ${gameCode} started, entering prompting phase.`);
			await helpers.broadcastWaitingGames(io, db);

		} catch (err) {
			console.error(`Error starting game ${gameCode}:`, err);
			socket.emit('error_message', 'Failed to start game. Database error.');
		}
	});

        // Player submits initial prompt
        socket.on('submit_prompt', async (data) => {
            const { gameCode, playerId, promptText } = data;
            if (!promptText?.trim()) return socket.emit('error_message', 'Prompt cannot be empty.');
            try {
                const game = await db.getGameSettings(null, gameCode);
                 if (!game) return socket.emit('error_message', 'Game not found during prompt submission.');
                const threadId = await db.getThreadIdForPlayerPrompt(gameCode, playerId);
                if (!threadId) throw new Error('Could not find active thread for player prompt.');
                await db.saveStep(threadId, playerId, 0, 'prompt', promptText.trim(), null);
                socket.emit('submission_received', { type: 'prompt' });
                // Call gameLogic function, pass dependencies
                await gameLogic.checkPhaseCompletion(io, db, activeTimers, gameAssignments, gameCode, game.game_id);
            } catch (err) {
                console.error(`Error submitting prompt for P:${playerId} G:${gameCode}:`, err);
                socket.emit('error_message', `Failed to save prompt: ${err.message}`);
            }
        });

        // Player submits drawing
        socket.on('submit_drawing', async (data) => {
            const { gameCode, playerId, drawingDataUrl, threadId } = data;
            if (!drawingDataUrl || !threadId) return socket.emit('error_message', 'Drawing data or context missing.');
            try {
                const base64Data = drawingDataUrl.split(',')[1];
                if (!base64Data) throw new Error('Invalid drawing data format.');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const game = await db.getGameSettings(null, gameCode);
                if (!game) throw new Error('Game not found for drawing submission.');
                const stepNumber = (game.current_round * 2) - 1;
                await db.saveStep(threadId, playerId, stepNumber, 'drawing', null, imageBuffer);
                socket.emit('submission_received', { type: 'drawing' });
                // Call gameLogic function, pass dependencies
                await gameLogic.checkPhaseCompletion(io, db, activeTimers, gameAssignments, gameCode, game.game_id);
            } catch (err) {
                console.error(`Error submitting drawing for P:${playerId} T:${threadId}:`, err);
                socket.emit('error_message', `Failed to save drawing: ${err.message}`);
            }
        });

        // Player submits guess
        socket.on('submit_guess', async (data) => {
            const { gameCode, playerId, guessText, threadId } = data;
            if (!guessText?.trim() || !threadId) return socket.emit('error_message', 'Guess or context missing.');
            try {
                const game = await db.getGameSettings(null, gameCode);
                if (!game) throw new Error('Game not found for guess submission.');
                const stepNumber = game.current_round * 2;
                await db.saveStep(threadId, playerId, stepNumber, 'guess', guessText.trim(), null);
                socket.emit('submission_received', { type: 'guess' });
                // Call gameLogic function, pass dependencies
                await gameLogic.checkPhaseCompletion(io, db, activeTimers, gameAssignments, gameCode, game.game_id);
            } catch (err) {
                console.error(`Error submitting guess for P:${playerId} T:${threadId}:`, err);
                socket.emit('error_message', `Failed to save guess: ${err.message}`);
            }
        });

    }); // End io.on('connection')
} // End initializeSocketHandlers function

module.exports = {
    initializeSocketHandlers
    // We don't export activeTimers or connectedSockets directly,
    // they are managed internally by this module now.
};