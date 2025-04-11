// telestration/gameLogic.js - Fixed phase completion logic

const helpers = require('./helpers');

// Helper function to calculate expected step number based on game state
function calculateCurrentStepNumber(gameSettings) {
    const { status, current_round: currentRound } = gameSettings;
    // Round 0: Prompt=0, Initial Draw=1
    if (currentRound === 0) {
        if (status === 'prompting') return 0;
        if (status === 'initial_drawing') return 1;
    }
    // Rounds >= 1: Guess follows Draw
    // Round 1: Guess=2, Draw=3
    // Round 2: Guess=4, Draw=5
    // Formula: Step = round * 2 + (is_guess ? 0 : 1) -> This formula is slightly off.
    // Let's use status mapping:
    if (status === 'guessing') {
        return currentRound * 2; // Guess step number is round * 2
    }
    if (status === 'drawing') {
        return currentRound * 2 + 1; // Draw step number is round * 2 + 1
    }

    console.warn(`Could not determine step number for status: ${status}, round: ${currentRound}`);
    return null; // Unknown state
}


// --- Game Start ---
async function startGame(io, db, gameId, activeTimers) {
    console.log(`Logic: Starting game ${gameId}`);
    // 1. Update game status to 'prompting'
    await db.updateGameStatus(gameId, 'prompting', 'prompt', 0); // Round 0, Step 'prompt'

    // 2. Get players
    const players = await db.getActivePlayers(gameId);
    if (players.length < 2) {
        throw new Error("Not enough active players to start."); // Re-check just in case
    }

    // 3. Create initial threads (one per player)
    await db.createThreadsForPlayers(gameId, players);
    console.log(`Logic: Created initial threads for game ${gameId}`);

    // 4. Notify players game has started and assign first task (prompt)
    const gameSettings = await db.getGameSettings(gameId); // Get updated settings
    const promptTimeLimit = gameSettings.prompt_time_limit_sec;

    // Emit to the room associated with the gameId (assuming room name is gameCode)
    // We need gameCode here! Let's fetch it again or pass it through.
    const gameCode = gameSettings.game_code;
    io.to(gameCode).emit('game_started', { numRounds: gameSettings.num_rounds }); // Inform clients game started
    console.log(`Logic: Notified room ${gameCode} game started.`);

    // Assign task to each player
    players.forEach(player => {
        if (player.socket_id) {
             io.to(player.socket_id).emit('task_prompt', {
                 timer: promptTimeLimit,
                 // Add any other data needed for the prompt task
             });
             console.log(`Logic: Sent task_prompt to P:${player.player_id} (${player.socket_id})`);
        } else {
            console.warn(`Logic: Player ${player.player_id} has no active socket_id, cannot assign task.`);
            // Consider marking inactive immediately? Or let timeout handle it.
        }
    });

    // 5. Start phase timer
    startPhaseTimer(io, db, gameId, 'prompting', promptTimeLimit, activeTimers);
}


// --- Phase Timer Logic ---
function startPhaseTimer(io, db, gameId, phase, timeLimitSec, activeTimers) {
    // Clear existing timer for this game, if any
    if (activeTimers[gameId]) {
        clearTimeout(activeTimers[gameId].timerId);
        console.log(`Logic: Cleared previous timer for game ${gameId}`);
    }

    const timeoutMs = timeLimitSec * 1000;
    console.log(`Logic: Starting ${phase} phase timer for game ${gameId} (${timeLimitSec}s)`);

    const timerId = setTimeout(async () => {
        console.log(`Logic: Timer expired for ${phase} phase in game ${gameId}.`);
        delete activeTimers[gameId]; // Remove timer now that it has fired

        // Force check phase completion after timeout
        try {
             // Fetch game code needed for emitting 'times_up' to room
             const gameSettings = await db.getGameSettings(gameId);
             if (!gameSettings) {
                 console.error(`Logic: Cannot force check phase, game settings not found for game ${gameId}`);
                 return;
             }
             const gameCode = gameSettings.game_code;
            io.to(gameCode).emit('times_up', { phase: phase }); // Notify clients time is up
            await checkPhaseCompletion(io, db, gameId, true, activeTimers); // Force check
        } catch (err) {
            console.error(`Logic: Error during forced phase completion check for game ${gameId}:`, err);
        }
    }, timeoutMs);

    // Store the new timer
    activeTimers[gameId] = { timerId, timeoutValue: timeoutMs };
}

// --- Check Phase Completion ---
async function checkPhaseCompletion(io, db, gameId, forceCheck = false, activeTimers) {
    console.log(`Logic: Checking phase completion for game ${gameId}. Forced: ${forceCheck}`);
    try {
        const gameSettings = await db.getGameSettings(gameId);
        if (!gameSettings || ['waiting', 'revealing', 'finished'].includes(gameSettings.status)) {
            console.log(`Logic: Game ${gameId} is not in an active phase (${gameSettings?.status}). No check needed.`);
            return;
        }

        // *** FIX: Calculate the expected step number for the CURRENT phase ***
        const expectedStepNumber = calculateCurrentStepNumber(gameSettings);
        if (expectedStepNumber === null) {
             console.error(`Logic: Could not determine expected step number for G:${gameId} status ${gameSettings.status}. Cannot check completion.`);
             return; // Cannot proceed if step number is unknown
        }
        const currentStepType = gameSettings.current_step_type; // e.g., 'prompt', 'drawing', 'guess'

        // Get the number of active players/threads expected to submit
        // For prompt/initial draw, it's active players. For subsequent, active threads.
        let numExpectedSubmissions;
        if (expectedStepNumber === 0 || expectedStepNumber === 1) { // Prompt or Initial Draw
             const activePlayers = await db.getActivePlayers(gameId);
             numExpectedSubmissions = activePlayers.length;
         } else { // Guessing or Subsequent Drawing
             const activeThreads = await db.getActiveThreadIds(gameId);
             numExpectedSubmissions = activeThreads.length;
         }

         if (numExpectedSubmissions === 0) {
             console.log(`Logic: No active players/threads found for G:${gameId}. Ending game?`);
             // TODO: Implement game ending logic if everyone disconnects/times out
             await db.updateGameStatus(gameId, 'finished'); // Mark as finished?
              if (activeTimers[gameId]) { clearTimeout(activeTimers[gameId].timerId); delete activeTimers[gameId]; } // Clear timer
             return;
         }

        // Get the count of actual submissions for this step
        // *** FIX: Use expectedStepNumber and currentStepType ***
        const submissionsCount = await db.countSubmittedSteps(gameId, expectedStepNumber, currentStepType);
        console.log(`Logic: G:${gameId}, Step:${expectedStepNumber} (${currentStepType}). Expected: ${numExpectedSubmissions}, Submitted: ${submissionsCount}.`);

        // Check if phase is complete
        if (submissionsCount >= numExpectedSubmissions) {
            console.log(`Logic: Phase complete for G:${gameId}, Step:${expectedStepNumber}. Transitioning...`);
            if (activeTimers[gameId]) { // Clear timer early if phase completes before timeout
                clearTimeout(activeTimers[gameId].timerId);
                delete activeTimers[gameId];
                console.log(`Logic: Cleared timer early for G:${gameId}`);
            }
            await transitionToNextPhase(io, db, gameId, activeTimers);
        } else if (forceCheck) {
            // Timer expired, but not all submitted. Handle timeouts/dropouts.
            console.log(`Logic: G:${gameId}, Step:${expectedStepNumber} timed out. Handling non-submissions...`);

             // Find who *did* submit for this step
             const submittedStepsData = await db.getSubmittedStepsForPhase(gameId, expectedStepNumber); // Fetches { player_id, thread_id }
             const submittedPlayerIds = new Set(submittedStepsData.map(s => s.player_id));
             const submittedThreadIds = new Set(submittedStepsData.map(s => s.thread_id));

            // Deactivate threads associated with non-submissions
            // This logic needs refinement depending on whether we compare against players or threads
             let threadsToCheck = [];
             if (expectedStepNumber === 0 || expectedStepNumber === 1) {
                // Compare against active players
                 const activePlayers = await db.getActivePlayers(gameId);
                 const expectedPlayerIds = activePlayers.map(p => p.player_id);
                 const nonSubmittingPlayerIds = expectedPlayerIds.filter(pid => !submittedPlayerIds.has(pid));
                 console.log(`Logic: G:${gameId} Non-submitting players for Step ${expectedStepNumber}: ${nonSubmittingPlayerIds.join(', ')}`);
                 // Find threads originating from these players
                 for(const pId of nonSubmittingPlayerIds) {
                     const threadId = await db.getThreadIdForPlayerPrompt(gameSettings.game_code, pId); // Requires game_code
                     if (threadId) {
                         await db.deactivateThread(threadId);
                     }
                 }
             } else {
                // Compare against active threads directly
                 const activeThreadIds = await db.getActiveThreadIds(gameId);
                 const nonSubmittingThreadIds = activeThreadIds.filter(tid => !submittedThreadIds.has(tid));
                 console.log(`Logic: G:${gameId} Non-submitting threads for Step ${expectedStepNumber}: ${nonSubmittingThreadIds.join(', ')}`);
                 for (const threadId of nonSubmittingThreadIds) {
                    await db.deactivateThread(threadId);
                 }
             }

            // After handling dropouts, transition to the next phase
            console.log(`Logic: G:${gameId} Finished handling timeouts. Transitioning...`);
            await transitionToNextPhase(io, db, gameId, activeTimers);
        } else {
            console.log(`Logic: Phase not yet complete for G:${gameId}, Step:${expectedStepNumber}. Waiting for more submissions.`);
        }

    } catch (err) {
        console.error(`Logic: Error checking phase completion for game ${gameId}:`, err);
        // Consider how to handle this - maybe try again later? Notify admin?
    }
}


// --- Transition to Next Phase ---
async function transitionToNextPhase(io, db, gameId, activeTimers) {
    try {
        const gameSettings = await db.getGameSettings(gameId);
        if (!gameSettings || ['revealing', 'finished'].includes(gameSettings.status)) {
            console.log(`Logic: G:${gameId} already revealing or finished. No transition.`);
            return;
        }

        let nextStatus = '';
        let nextStepType = '';
        let nextRound = gameSettings.current_round;
        let timeLimit = 0;
        const currentStepNumber = calculateCurrentStepNumber(gameSettings); // Calculate current step num

        // Determine next state based on current state
        switch (gameSettings.status) {
            case 'prompting': // After prompts are submitted
                nextStatus = 'initial_drawing';
                nextStepType = 'drawing';
                nextRound = 0; // Stays round 0
                timeLimit = gameSettings.draw_time_limit_sec;
                break;
            case 'initial_drawing': // After initial drawings (Step 1)
                nextStatus = 'guessing';
                nextStepType = 'guess';
                nextRound = 1; // Move to round 1
                timeLimit = gameSettings.guess_time_limit_sec;
                break;
            case 'guessing': // After guesses (e.g., Step 2, 4, ...)
                // Check if max rounds reached
                 if (gameSettings.current_round >= gameSettings.num_rounds) {
                    nextStatus = 'revealing'; // End game
                } else {
                    nextStatus = 'drawing'; // Next is drawing
                    nextStepType = 'drawing';
                    // Round number already incremented when entering guessing phase, so it stays the same here
                    timeLimit = gameSettings.draw_time_limit_sec;
                }
                break;
            case 'drawing': // After drawings (e.g., Step 3, 5, ...)
                nextStatus = 'guessing';
                nextStepType = 'guess';
                nextRound = gameSettings.current_round + 1; // Increment round
                timeLimit = gameSettings.guess_time_limit_sec;
                 // Check if max rounds reached AFTER incrementing round (is this right?)
                 // If we just finished drawing round N, the next guess is round N+1.
                 // Reveal should happen AFTER the guess of the *last* configured round.
                 // Example: num_rounds=2. R1 Draw (step 3) -> R2 Guess (step 4). R2 Draw (step 5) -> Reveal.
                 // So, if nextRound > num_rounds, we reveal.
                 if (nextRound > gameSettings.num_rounds) {
                     nextStatus = 'revealing'; // End game
                 }
                break;
            default:
                console.error(`Logic: Unknown current status "${gameSettings.status}" for G:${gameId}. Cannot transition.`);
                return;
        }

        console.log(`Logic: G:${gameId} Transitioning from ${gameSettings.status} (R:${gameSettings.current_round}) to ${nextStatus} (R:${nextRound})`);

        // Update game status in DB *before* assigning tasks
        await db.updateGameStatus(gameId, nextStatus, nextStepType, nextRound);

        // --- Handle Next Phase Actions ---
        if (nextStatus === 'revealing') {
            await triggerReveal(io, db, gameId, activeTimers);
        } else if (nextStatus === 'finished') {
            // Clean up, maybe notify players game is truly over?
             console.log(`Logic: G:${gameId} reached 'finished' state.`);
             if (activeTimers[gameId]) { clearTimeout(activeTimers[gameId].timerId); delete activeTimers[gameId]; }
        } else {
            // Assign tasks for the new phase (drawing or guessing)
            await assignTasksAndNotify(io, db, gameId, nextStatus, nextStepType, nextRound, timeLimit, activeTimers);
        }

    } catch (err) {
        console.error(`Logic: Error transitioning phase for game ${gameId}:`, err);
    }
}

// --- Assign Tasks for Drawing/Guessing ---
async function assignTasksAndNotify(io, db, gameId, status, stepType, round, timeLimit, activeTimers) {
    console.log(`Logic: G:${gameId} Assigning tasks for ${status} phase (Round ${round})`);
    try {
        const gameSettings = await db.getGameSettings(gameId); // Use latest settings
        const gameCode = gameSettings.game_code;
        const previousStepNumber = calculateCurrentStepNumber({ ...gameSettings, status: status, current_round: round }) - 1; // Calculate the step number just completed

        if (previousStepNumber < 0) {
             console.error(`Logic: G:${gameId} Invalid previous step number calculated (${previousStepNumber}). Aborting task assignment.`);
             return;
        }

        // Get content type needed from previous step
        const contentTypeColumn = (stepType === 'guess') ? 'image_content' : 'text_content';
        const taskEvent = (stepType === 'guess') ? 'task_guess' : 'task_draw';

        // Get data from the previous step for all *active* threads
        const previousStepItems = await db.getPreviousStepDataForAssignment(gameId, previousStepNumber, contentTypeColumn);
        console.log(`Logic: G:${gameId} Found ${previousStepItems.length} items from previous step ${previousStepNumber} for assignment.`);

        if (previousStepItems.length === 0) {
            console.log(`Logic: G:${gameId} No active threads/items from previous step. Ending game?`);
             await triggerReveal(io, db, gameId, activeTimers); // Go to reveal if no items?
            return;
        }

        // Get list of currently active players still in the game
        const activePlayers = await db.getActivePlayers(gameId);
        const activePlayerIds = activePlayers.map(p => p.player_id);
        const activePlayerSockets = activePlayers.reduce((map, p) => {
            if (p.socket_id) map[p.player_id] = p.socket_id;
            return map;
        }, {});


         if (activePlayerIds.length === 0) {
             console.log(`Logic: G:${gameId} No active players left. Ending game?`);
             await triggerReveal(io, db, gameId, activeTimers); // Go to reveal if no players?
             return;
         }

        // --- Assignment Logic ---
        // Goal: Assign each item to a different active player than the one who created it,
        //       and preferably different from the thread originator. Avoid assigning to inactive players.
        const assignments = {}; // playerId -> { threadId, content, previousPlayerId, originalPlayerId }
        let availableItems = helpers.shuffleArray([...previousStepItems]); // Shuffle items for randomness
        let playerRotation = helpers.shuffleArray([...activePlayerIds]); // Shuffle players

        // Simple rotation assignment (can be improved)
        for (let i = 0; i < playerRotation.length; i++) {
            const currentPlayerId = playerRotation[i];
            const itemToAssign = availableItems[i % availableItems.length]; // Cycle through items

            // Basic check: don't assign item back to the player who just submitted it
            if (itemToAssign.previous_player_id === currentPlayerId && playerRotation.length > 1 && availableItems.length > 1) {
                // Try the next item (simple swap logic)
                const nextItemIndex = (i + 1) % availableItems.length;
                 // Check if swapping with next item works
                 if (availableItems[nextItemIndex].previous_player_id !== currentPlayerId && playerRotation[(i+1) % playerRotation.length] !== itemToAssign.previous_player_id) {
                    // Swap items for assignment between current player and next player in rotation
                     const temp = availableItems[i % availableItems.length];
                     availableItems[i % availableItems.length] = availableItems[nextItemIndex];
                     availableItems[nextItemIndex] = temp;
                     assignments[currentPlayerId] = availableItems[i % availableItems.length];
                     // Assign original item to the next player
                     const nextPlayerId = playerRotation[(i+1) % playerRotation.length];
                     assignments[nextPlayerId] = temp;
                     i++; // Skip next iteration as we assigned two
                     continue; // Move to next player after the pair
                 } else {
                      // Can't easily swap, just assign (might get own back in small games)
                      assignments[currentPlayerId] = itemToAssign;
                 }

            } else {
                assignments[currentPlayerId] = itemToAssign;
            }
        }

        console.log(`Logic: G:${gameId} Assigned ${Object.keys(assignments).length} tasks for ${stepType} phase.`);

        // Emit tasks to assigned players
        for (const playerIdStr in assignments) {
             const playerId = parseInt(playerIdStr, 10);
             const assignment = assignments[playerId];
             const socketId = activePlayerSockets[playerId];

             if (socketId) {
                 let contentToSend = assignment.content;
                 // Convert image buffer to base64 data URL if sending drawing for guessing
                 if (stepType === 'guess' && Buffer.isBuffer(contentToSend)) {
                     contentToSend = `data:image/png;base64,${contentToSend.toString('base64')}`;
                 } else if (stepType === 'guess' && contentToSend == null) {
                     console.warn(`Logic: G:${gameId} Missing image content for T:${assignment.thread_id} Step:${previousStepNumber}`);
                     contentToSend = "[Image not available]";
                 }

                 io.to(socketId).emit(taskEvent, {
                     threadId: assignment.thread_id,
                     content: contentToSend, // Text prompt or image data URL
                     timer: timeLimit
                 });
                 console.log(`Logic: G:${gameId} Sent ${taskEvent} for T:${assignment.thread_id} to P:${playerId} (${socketId})`);
             } else {
                 console.warn(`Logic: G:${gameId} No active socket for P:${playerId}, cannot send task ${taskEvent}. Thread T:${assignment?.thread_id} may time out.`);
                 // If player has no socket, their thread will eventually be marked inactive by timeout check
             }
         }

        // Start timer for the new phase
        startPhaseTimer(io, db, gameId, status, timeLimit, activeTimers);

    } catch (err) {
        console.error(`Logic: G:${gameId} Error assigning tasks for ${status} phase:`, err);
        // Maybe try to force reveal? Or notify players of error?
         io.to(gameSettings?.game_code || gameId).emit('error_message', 'An internal error occurred while assigning tasks.'); // Use gameCode if available
    }
}


// --- Trigger Reveal ---
async function triggerReveal(io, db, gameId, activeTimers) {
    console.log(`Logic: G:${gameId} Triggering reveal.`);
     if (activeTimers[gameId]) { // Ensure timer is cleared
         clearTimeout(activeTimers[gameId].timerId);
         delete activeTimers[gameId];
     }
    try {
        // Update game status
        await db.updateGameStatus(gameId, 'revealing'); // No round/step type needed

        // Fetch data for all active threads
        const revealData = await db.getRevealData(gameId);

        // Get game code to emit to the room
        const gameSettings = await db.getGameSettings(gameId);
        const gameCode = gameSettings?.game_code;

        if(gameCode) {
            io.to(gameCode).emit('reveal_data', revealData);
            console.log(`Logic: G:${gameId} Sent reveal data for ${revealData.length} threads to room ${gameCode}.`);
        } else {
             console.error(`Logic: G:${gameId} Cannot find game code to send reveal data.`);
        }

        // Optional: Transition to 'finished' state after a delay?
        // setTimeout(async () => {
        //     await db.updateGameStatus(gameId, 'finished');
        // }, 60000); // e.g., 1 minute later

    } catch (err) {
        console.error(`Logic: G:${gameId} Error triggering reveal:`, err);
        // Notify players?
        const gameSettings = await db.getGameSettings(gameId); // Attempt to get game code for error message
         io.to(gameSettings?.game_code || gameId).emit('error_message', 'An error occurred while preparing the reveal.');
    }
}


module.exports = {
    startGame,
    checkPhaseCompletion,
    calculateCurrentStepNumber, // Export helper if needed elsewhere
    // transitionToNextPhase, // Primarily internal?
    // assignTasksAndNotify, // Primarily internal?
    // triggerReveal // Primarily internal?
};