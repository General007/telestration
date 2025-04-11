// telestration/socketHandlers.js - Fixed waiting game broadcast

const gameLogic = require('./gameLogic');
const helpers = require('./helpers'); // Ensure helpers is required

// Store active timers (gameId -> { timerId, timeoutValue })
const activeTimers = {};

// Function to initialize socket event handlers
function initializeSocketHandlers(io, db) {
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);

        // --- Handler: Create Game ---
        socket.on('create_game', async (data) => {
            console.log(`Admin ${socket.id} attempting to create game:`, data);
            const { gameCode, playerName, numRounds, promptTime, drawTime, guessTime } = data;
            // TODO: Add validation for input data

            try {
                // Use db module to create game and player (GM)
                const { gameId, playerId } = await db.createGameAndPlayer(
                    gameCode || helpers.generateGameCode(), // Generate code if blank
                    playerName || 'Admin', // Default name
                    socket.id, // Associate socket ID with GM
                    numRounds || 2,
                    promptTime || 60,
                    drawTime || 300,
                    guessTime || 120
                );

                // Auto-join the creator (GM) to the game room
                socket.join(gameCode);
                console.log(`Admin ${socket.id} (Player ID: ${playerId}) created and joined Game ${gameCode} (ID: ${gameId}).`);

                // Send confirmation back to the creator
                socket.emit('game_created', { gameCode: gameCode, playerId: playerId, gameId: gameId, playerName: playerName || 'Admin' });

                // *** FIX: Broadcast updated waiting games list to EVERYONE ***
                await helpers.broadcastWaitingGames(io); // Use await if broadcastWaitingGames is async

            } catch (err) {
                console.error("Error creating game:", err);
                socket.emit('error_message', `Failed to create game: ${err.message}`);
            }
        });

        // --- Handler: Join Game ---
        socket.on('join_game', async (data) => {
            const { gameCode, playerName } = data;
            console.log(`Player ${playerName} (${socket.id}) attempting to join game ${gameCode}`);
            // TODO: Add validation for player name

            try {
                // Find game settings by code
                const gameSettings = await db.getGameSettings(null, gameCode);
                if (!gameSettings || gameSettings.status !== 'waiting') {
                    throw new Error(`Game ${gameCode} not found or not waiting for players.`);
                }

                const gameId = gameSettings.game_id;
                let playerId;
                let joiningAs = playerName; // Store the name they intend to join as

                // Check if player is rejoining (inactive with same name)
                const inactivePlayerId = await db.findInactivePlayer(gameId, playerName);
                if (inactivePlayerId) {
                    console.log(`Player ${playerName} is rejoining game ${gameCode}.`);
                    await db.reactivatePlayer(inactivePlayerId, socket.id);
                    playerId = inactivePlayerId;
                     // Re-fetch game settings if needed, or assume they are current
                } else {
                    // Add new player to the game (checks for active duplicate names)
                    playerId = await db.addPlayerToGame(gameId, playerName, socket.id);
                }

                socket.join(gameCode); // Join the Socket.IO room

                // Fetch updated player list for the room
                const players = await db.getActivePlayers(gameId);

                // Notify everyone in the room (including newcomer) about the updated player list
                io.to(gameCode).emit('player_list_update', players);
                 // Send confirmation *to the joining player only*
                socket.emit('game_joined', {
                    gameCode: gameCode,
                    playerId: playerId,
                    gameId: gameId,
                    playerName: joiningAs, // Send back the name they used
                    settings: gameSettings // Send game settings (timer limits etc)
                 });

                console.log(`Player ${joiningAs} (Player ID: ${playerId}, Socket: ${socket.id}) joined Game ${gameCode}. Room size: ${io.sockets.adapter.rooms.get(gameCode)?.size}`);

                // Broadcast updated waiting games list as player count changed
                await helpers.broadcastWaitingGames(io);

            } catch (err) {
                console.error(`Error joining game ${gameCode} for player ${playerName}:`, err);
                socket.emit('error_message', `Failed to join game: ${err.message}`);
            }
        });

        // --- Handler: Request Waiting Games ---
        // Client explicitly asks for the list (e.g., on initial page load)
        socket.on('request_waiting_games', async () => {
            console.log(`Socket ${socket.id} requested waiting games list.`);
            try {
                const waitingGames = await helpers.getWaitingGames(); // Directly get games
                socket.emit('waiting_games_list', waitingGames); // Send only to requesting client
            } catch (err) {
                console.error("Error fetching waiting games for single client:", err);
                socket.emit('waiting_games_list', []); // Send empty list on error
            }
        });


        // --- Handler: Start Game ---
        socket.on('start_game', async (data) => {
            const { gameCode } = data;
            try {
                console.log(`Attempting to start game ${gameCode} by socket ${socket.id}`);
                // Authenticate: Only GM can start
                const playerData = await db.findPlayerDataBySocket(socket.id);
                const gameSettings = await db.getGameSettings(null, gameCode);

                if (!playerData || !gameSettings || playerData.game_id !== gameSettings.game_id) {
                    throw new Error("Player or game not found.");
                }
                if (gameSettings.game_master_player_id !== playerData.player_id) {
                    throw new Error("Only the Game Master can start the game.");
                }
                if (gameSettings.status !== 'waiting') {
                     throw new Error("Game is not in a 'waiting' state.");
                 }
                const players = await db.getActivePlayers(gameSettings.game_id);
                 if (players.length < 2) { // Need at least 2 players
                     throw new Error("Need at least 2 players to start.");
                 }

                // --- Start Game Logic (moved to gameLogic) ---
                await gameLogic.startGame(io, db, gameSettings.game_id, activeTimers);

                // Broadcast updated waiting games list as this game is no longer waiting
                await helpers.broadcastWaitingGames(io);

            } catch (err) {
                console.error(`Error starting game ${gameCode}:`, err);
                socket.emit('error_message', `Failed to start game: ${err.message}`);
            }
        });

         // --- Handler: Submit Prompt ---
        socket.on('submit_prompt', async (data) => {
            const { gameCode, playerId, promptText } = data;
            // TODO: Add validation
            try {
                console.log(`Player ${playerId} submitting prompt for ${gameCode}`);
                const gameSettings = await db.getGameSettings(null, gameCode);
                if (!gameSettings || (gameSettings.status !== 'prompting' && gameSettings.status !== 'waiting')) { // Allow submission even if somehow back in waiting? Or just prompting.
                    throw new Error("Game not found or not accepting prompts.");
                }
                 const gameId = gameSettings.game_id;

                // Find the player's specific thread ID (prompt originates thread)
                const threadId = await db.getThreadIdForPlayerPrompt(gameCode, playerId);
                if (!threadId) {
                    throw new Error(`Could not find active thread for player ${playerId} in game ${gameCode}`);
                }

                // Save the step (Step 0: Prompt)
                await db.saveStep(threadId, playerId, 0, 'prompt', promptText, null);
                console.log(`Saved prompt for P:${playerId} T:${threadId} G:${gameId}`);

                 // Notify submission successful
                 socket.emit('submission_accepted', { stepType: 'prompt' });

                // Check if phase complete
                await gameLogic.checkPhaseCompletion(io, db, gameId, false, activeTimers);

            } catch (err) {
                console.error(`Error submitting prompt for P:${playerId} G:${gameCode}:`, err);
                socket.emit('error_message', `Failed to submit prompt: ${err.message}`);
            }
        });

        // --- Handler: Submit Drawing ---
        socket.on('submit_drawing', async (data) => {
            const { gameCode, playerId, threadId, drawingData } = data; // drawingData expected as base64 data URL string
            try {
                console.log(`Player ${playerId} submitting drawing for T:${threadId} G:${gameCode}`);
                const gameSettings = await db.getGameSettings(null, gameCode);
                 if (!gameSettings || (gameSettings.status !== 'initial_drawing' && gameSettings.status !== 'drawing')) {
                    throw new Error("Game not found or not accepting drawings.");
                }
                const gameId = gameSettings.game_id;

                // Determine current step number based on game state
                // This needs refinement - relies on accurate status/round tracking
                const stepNumber = gameLogic.calculateCurrentStepNumber(gameSettings); // Use helper function

                if (stepNumber === null) {
                    throw new Error("Could not determine current step number from game state.");
                }

                // Convert base64 data URL to Buffer for BYTEA storage
                // Assumes format like "data:image/png;base64,iVBORw0KGgo..."
                let imageBuffer = null;
                if (drawingData && drawingData.startsWith('data:image/')) {
                    const base64Data = drawingData.split(',')[1];
                    if(base64Data) {
                        imageBuffer = Buffer.from(base64Data, 'base64');
                    } else {
                         throw new Error("Invalid drawing data format (missing data).");
                    }
                } else if (drawingData) {
                     throw new Error("Invalid drawing data format (not a data URL).");
                 } else {
                     throw new Error("Missing drawing data.");
                 }

                // Save the step
                await db.saveStep(threadId, playerId, stepNumber, 'drawing', null, imageBuffer);
                console.log(`Saved drawing Step #${stepNumber} for P:${playerId} T:${threadId} G:${gameId}`);

                // Notify submission successful
                socket.emit('submission_accepted', { stepType: 'drawing' });

                // Check if phase complete
                await gameLogic.checkPhaseCompletion(io, db, gameId, false, activeTimers);

            } catch (err) {
                console.error(`Error submitting drawing for P:${playerId} T:${threadId} G:${gameCode}:`, err);
                socket.emit('error_message', `Failed to submit drawing: ${err.message}`);
            }
        });

        // --- Handler: Submit Guess ---
        socket.on('submit_guess', async (data) => {
            const { gameCode, playerId, threadId, guessText } = data;
            try {
                console.log(`Player ${playerId} submitting guess for T:${threadId} G:${gameCode}`);
                const gameSettings = await db.getGameSettings(null, gameCode);
                 if (!gameSettings || gameSettings.status !== 'guessing') {
                    throw new Error("Game not found or not accepting guesses.");
                }
                 const gameId = gameSettings.game_id;

                 // Determine current step number
                 const stepNumber = gameLogic.calculateCurrentStepNumber(gameSettings); // Use helper function
                 if (stepNumber === null) {
                     throw new Error("Could not determine current step number from game state.");
                 }

                // Save the step
                await db.saveStep(threadId, playerId, stepNumber, 'guess', guessText, null);
                console.log(`Saved guess Step #${stepNumber} for P:${playerId} T:${threadId} G:${gameId}`);

                // Notify submission successful
                socket.emit('submission_accepted', { stepType: 'guess' });

                // Check if phase complete
                await gameLogic.checkPhaseCompletion(io, db, gameId, false, activeTimers);

            } catch (err) {
                console.error(`Error submitting guess for P:${playerId} T:${threadId} G:${gameCode}:`, err);
                socket.emit('error_message', `Failed to submit guess: ${err.message}`);
            }
        });

        // --- Handler: Get Random Prompt ---
        socket.on('get_random_prompt', async () => {
            try {
                const prompt = await db.getRandomPrompt();
                socket.emit('random_prompt_result', prompt);
            } catch (err) {
                console.error("Error getting random prompt:", err);
                socket.emit('error_message', "Failed to get random prompt.");
            }
        });


        // --- Handler: Disconnect ---
        socket.on('disconnect', async (reason) => {
            console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
            try {
                // Find player associated with this socket
                const playerData = await db.findPlayerDataBySocket(socket.id);
                if (playerData) {
                    const { player_id: playerId, game_id: gameId, game_code: gameCode, status } = playerData;
                    console.log(`Player ${playerId} in Game ${gameCode} (ID: ${gameId}) disconnected.`);

                    // Mark player as inactive in DB (keeps record, clears socket_id)
                    // Note: Deactivating threads now handled by timeout/missed submission
                    // await db.deactivatePlayer(playerId); // Consider if immediate deactivation is desired

                    // Only broadcast updates if game is still active/waiting
                    if (status === 'waiting' || status === 'prompting' || status === 'initial_drawing' || status === 'drawing' || status === 'guessing') {
                        // Fetch updated player list
                         const players = await db.getActivePlayers(gameId);
                        // Notify room members
                        io.to(gameCode).emit('player_list_update', players);
                        console.log(`Notified room ${gameCode} of player ${playerId} disconnection.`);

                        // If game was waiting, broadcast updated games list
                        if (status === 'waiting') {
                            await helpers.broadcastWaitingGames(io);
                        } else {
                            // If game in progress, check if disconnection impacts phase completion
                            // checkPhaseCompletion will run on timeout anyway, but could check sooner?
                            // Optional: Trigger an early check? Depends on desired dropout handling speed.
                             // await gameLogic.checkPhaseCompletion(io, db, gameId, false, activeTimers);
                         }
                    }
                } else {
                    console.log(`No active player found for disconnected socket ${socket.id}`);
                }
            } catch (err) {
                console.error(`Error handling disconnect for socket ${socket.id}:`, err);
            }
        });

    }); // end io.on('connection')

    console.log("Socket handlers initialized.");
} // end initializeSocketHandlers


module.exports = { initializeSocketHandlers, activeTimers };