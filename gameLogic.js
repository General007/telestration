// C:\TelestrationsGameApp\gameLogic.js

const helpers = require('./helpers'); // May need helpers like broadcastWaitingGames

// Moved startPhaseTimer here as it's part of game flow logic
// Now accepts io, activeTimers, db as parameters
function startPhaseTimer(io, activeTimers, db, gameCode, gameId, phase, durationSeconds) {
    // Clear previous timer for this game/phase if any
    clearTimeout(activeTimers[gameCode]?.timerId);

    // Ensure duration is valid
    const validDuration = (typeof durationSeconds === 'number' && durationSeconds > 0) ? durationSeconds : 60; // Default 60s
    console.log(`Starting ${phase} timer for ${gameCode} (${validDuration}s)`);
    // Emit timer start to clients in the room
    io.to(gameCode).emit('start_timer', { phase, duration: validDuration });

    // Set server-side timeout
    const timerId = setTimeout(async () => {
        console.log(`${phase} timer ended for ${gameCode}. Forcing transition.`);
        // Notify clients time is up
        io.to(gameCode).emit('times_up', { phase });

        // Check if game still exists before proceeding
        const gameExists = await db.getGameSettings(gameId);
        if (gameExists) {
            // Call checkPhaseCompletion again with force=true
            // Need to pass all dependencies
            await checkPhaseCompletion(io, db, activeTimers, gameCode, gameId, true);
        } else {
            console.warn(`Timer ended for game ${gameCode} (ID: ${gameId}), but game no longer exists.`);
        }
        // Remove timer reference after execution
        delete activeTimers[gameCode];
    }, validDuration * 1000);

    // Store the timer reference
    activeTimers[gameCode] = { timerId, phase };
}

// REPLACEMENT for checkPhaseCompletion in gameLogic.js

// Import the new db function
// Note: db object is passed in, so methods are like db.deactivateThread
// const { deactivateThread } = require('./db'); // No - db is passed

// C:\TelestrationsGameApp\gameLogic.js

// (Make sure helpers and potentially db are required/accessible if needed)
// const helpers = require('./helpers');
// const db = require('./db'); // db is passed in, so not required here

async function checkPhaseCompletion(io, db, activeTimers, gameAssignments, gameCode, gameId, forceTransition = false) {
    console.log(`Checking phase completion for game ${gameCode} (Force: ${forceTransition})`);
    try {
        const game = await db.getGameSettings(gameId);
        if (!game || ['waiting', 'revealing', 'finished'].includes(game.status)) {
            console.log(`  -> Game ${gameCode} not in checkable state (${game?.status}). Exiting check.`);
            return;
        }

        const activeThreadIds = await db.getActiveThreadIds(gameId);
        let requiredCount = activeThreadIds.length; // Initial required count

        if (requiredCount === 0 && !forceTransition) {
             console.log(`  -> No active threads remaining in game ${gameCode}. Ending game.`);
             await db.updateGameStatus(gameId, 'finished');
             io.to(gameCode).emit('game_over', { message: 'No active threads left.' });
             clearTimeout(activeTimers[gameCode]?.timerId); delete activeTimers[gameCode];
             // Clear assignments if game ends prematurely
             if(gameAssignments[gameCode]) delete gameAssignments[gameCode];
             return;
        }

        let expectedStepNumber;
        const currentStatus = game.status;
        const currentStepType = game.current_step_type;

        // Determine expected step number based on current game status
        if (currentStatus === 'prompting') expectedStepNumber = 0;
        else if (currentStatus === 'initial_drawing') expectedStepNumber = 1;
        else if (currentStatus === 'drawing') expectedStepNumber = (game.current_round * 2) - 1; // Normal draw rounds 3, 5...
        else if (currentStatus === 'guessing') expectedStepNumber = game.current_round * 2; // Normal guess rounds 2, 4...
        else { console.log(`  -> Unexpected game status '${currentStatus}'. Exiting check.`); return; }

        if (!currentStepType) { console.error(`  -> ERROR: current_step_type is NULL for game ${gameCode} in status ${currentStatus}. Cannot count steps.`); return; }

        // Count how many submissions exist for this specific step among ACTIVE threads
        const submittedCount = await db.countSubmittedSteps(gameId, expectedStepNumber, currentStepType);
        console.log(`  -> Status: ${currentStatus}, Expecting Step#: ${expectedStepNumber}, Type: ${currentStepType}`);
        console.log(`  -> Submitted Count: ${submittedCount}, Required Count: ${requiredCount}`);

        // --- Dropout Detection & Handling on Forced Transition ---
        let newlyDeactivatedThreadCount = 0;
        if (forceTransition && submittedCount < requiredCount) {
            console.log(`  -> Forced transition detected missing steps (${submittedCount}/${requiredCount}). Identifying inactive threads...`);

            // Get assignments for the phase that just timed out
            const phaseAssignments = gameAssignments[gameCode]; // Contains { phase: '...', assignments: { threadId: playerId, ... } }

            // Ensure we have assignments and they match the *current* step type being checked
            if (!phaseAssignments || phaseAssignments.phase !== currentStepType) {
                 console.error(`  -> !! Cannot determine who missed steps: Assignment data mismatch/missing for game ${gameCode}, phase ${currentStepType}. Expected assignments for phase '${phaseAssignments?.phase}'.`);
                 // Cannot reliably deactivate threads without correct assignment info
            } else {
                // Get players who actually submitted this step for active threads
                 const submittedStepsData = await db.getSubmittedStepsForPhase(gameId, expectedStepNumber); // Fetches { player_id, thread_id }
                 const submittedPlayerIds = new Set(submittedStepsData.map(step => step.player_id));

                 // Get player IDs who were assigned a task in this phase for currently active threads
                 const currentAssignments = phaseAssignments.assignments; // { threadId: playerId }
                 const assignedPlayerIdsThisPhase = new Set();
                 const threadsToDeactivate = [];

                 // Iterate through assignments to find who was assigned active threads
                 for (const threadIdStr in currentAssignments) {
                      const threadId = parseInt(threadIdStr, 10);
                      // Check if this thread is still supposed to be active
                      if (activeThreadIds.includes(threadId)) {
                           const assignedPlayerId = currentAssignments[threadIdStr];
                           assignedPlayerIdsThisPhase.add(assignedPlayerId);
                           // If this assigned player didn't submit, mark their thread for deactivation
                           if (!submittedPlayerIds.has(assignedPlayerId)) {
                                threadsToDeactivate.push(threadId);
                                console.log(`    -> Player ${assignedPlayerId} missed step ${expectedStepNumber} for thread ${threadId}.`);
                           }
                      }
                 }

                 console.log(`  -> Assigned players for active threads this phase: ${[...assignedPlayerIdsThisPhase]}`);
                 console.log(`  -> Submitted players this phase: ${[...submittedPlayerIds]}`);

                 if (threadsToDeactivate.length > 0) {
                     console.log(`  -> Deactivating threads due to missed step ${expectedStepNumber}: ${threadsToDeactivate}`);
                     for (const threadId of threadsToDeactivate) {
                         await db.deactivateThread(threadId);
                     }
                     newlyDeactivatedThreadCount = threadsToDeactivate.length;
                     // Update the required count for the transition check IF threads were deactivated
                     requiredCount -= newlyDeactivatedThreadCount;
                     console.log(`  -> New required count after deactivation: ${requiredCount}`);
                     // If required count drops to 0, end the game here?
                     if (requiredCount <= 0) {
                         console.log(`  -> All remaining threads deactivated. Ending game.`);
                         await db.updateGameStatus(gameId, 'finished');
                         io.to(gameCode).emit('game_over', { message: 'All active threads ended due to missed steps.' });
                         clearTimeout(activeTimers[gameCode]?.timerId); delete activeTimers[gameCode];
                         if(gameAssignments[gameCode]) delete gameAssignments[gameCode];
                         return; // Stop further processing
                     }
                 }
            }
        }
        // --- End Dropout Detection ---

        // Final check for phase completion (using potentially updated requiredCount if forced)
        // Note: submittedCount is NOT recalculated after deactivation, we transition based on who *did* submit among originally active threads.
        if (forceTransition || submittedCount >= requiredCount) {
            if(forceTransition && newlyDeactivatedThreadCount > 0) {
                console.log(`  -> Phase complete! (Forced by timer, ${newlyDeactivatedThreadCount} thread(s) deactivated). Calling transitionToNextPhase.`);
            } else if (forceTransition) {
                 console.log(`  -> Phase complete! (Forced by timer, all submissions received). Calling transitionToNextPhase.`);
            } else {
                 console.log(`  -> Phase complete! (Submissions meet requirement). Calling transitionToNextPhase.`);
            }

            clearTimeout(activeTimers[gameCode]?.timerId); delete activeTimers[gameCode];
            // Clear assignments for the completed phase
            if(gameAssignments[gameCode]) delete gameAssignments[gameCode];

            // Pass the game object retrieved at the start
            await transitionToNextPhase(io, db, activeTimers, gameAssignments, gameCode, gameId, game);
        } else {
             console.log(`  -> Phase not yet complete (${submittedCount}/${requiredCount} of originally active). Waiting for more submissions.`);
        }

    } catch (err) {
        console.error(`Error checking phase completion for ${gameCode}:`, err);
         io.to(gameCode).emit('error_message', 'Internal server error checking game progress.');
    }
}

// C:\TelestrationsGameApp\gameLogic.js

async function transitionToNextPhase(io, db, activeTimers, gameAssignments, gameCode, gameId, currentGame) {
    console.log(`Transitioning FROM Status: ${currentGame.status}, Round: ${currentGame.current_round}`);
    let nextStatus = '', nextStepType = null, nextRound = currentGame.current_round;
    let performAssignment = false, nextPhaseDuration = 0, isFinalStep = false;

    // Determine next state based on current state
    if (currentGame.status === 'prompting') {
        // Prompting (Round 0) -> Initial Drawing (Round 0)
        nextStatus = 'initial_drawing'; // New status for player drawing own prompt
        nextStepType = 'drawing';      // The action is drawing
        nextRound = 0;                 // Stay in conceptual round 0 for the first draw
        performAssignment = true;      // Need to assign prompts back to owners
        nextPhaseDuration = currentGame.draw_time_limit_sec; // Use drawing time
    } else if (currentGame.status === 'initial_drawing') {
        // Initial Drawing (Round 0) -> Guessing 1 (Round 1)
        nextStatus = 'guessing';
        nextStepType = 'guess';
        nextRound = 1; // Start Round 1 proper
        performAssignment = true; // Need to assign initial drawings for guessing
        nextPhaseDuration = currentGame.guess_time_limit_sec;
    } else if (currentGame.status === 'drawing') {
        // Normal Drawing (Round N >= 1) -> Guessing (Round N)
        nextStatus = 'guessing';
        nextStepType = 'guess';
        nextRound = currentGame.current_round; // Stay in same round
        performAssignment = true;
        nextPhaseDuration = currentGame.guess_time_limit_sec;
    } else if (currentGame.status === 'guessing') {
        // Guessing (Round N >= 1) -> Drawing (Round N+1) OR Reveal
        // Use the game-specific num_rounds setting loaded from DB
        if (currentGame.current_round < currentGame.num_rounds) {
            // Move to next drawing round
            nextStatus = 'drawing';
            nextStepType = 'drawing';
            nextRound = currentGame.current_round + 1; // Increment round
            performAssignment = true;
            nextPhaseDuration = currentGame.draw_time_limit_sec;
        } else {
            // Last configured round's guess complete, move to reveal
            nextStatus = 'revealing';
            nextStepType = null; // No specific step type for reveal
            nextRound = currentGame.current_round; // Keep final round number for context
            isFinalStep = true;
            performAssignment = false; // No assignment needed for reveal
             console.log(`  -> Determined NEXT Status: ${nextStatus} (Final Step)`);
        }
    } else {
        // Should not happen in normal flow
        console.error(`Game ${gameCode} in unexpected status '${currentGame.status}' for transition.`);
        return; // Exit if state is invalid
    }

    // Log the determined next state
    if (!isFinalStep) { // Don't log details if it's just revealing
         console.log(`  -> Determined NEXT Status: ${nextStatus}, StepType: ${nextStepType}, Round: ${nextRound}, Assign: ${performAssignment}`);
    }

    // Update game status in DB if a valid next state was determined
    if (nextStatus) {
         await db.updateGameStatus(gameId, nextStatus, nextStepType, nextRound);
         console.log(`  -> DB status updated.`);
    } else {
        console.error(`  -> ERROR: Failed to determine next status for game ${gameCode}. DB not updated.`);
         return; // Exit if failed to determine next state
    }

    // Perform next action: assign tasks or trigger reveal
    if (performAssignment) {
        console.log(`  -> Calling assignTasksAndNotify for ${nextStepType} phase (Target Status: ${nextStatus})`);
        // Pass all dependencies down, including gameAssignments state object and the target status
        await assignTasksAndNotify(io, db, activeTimers, gameAssignments, gameCode, gameId, nextStepType, nextPhaseDuration, nextRound, nextStatus);
    } else if (isFinalStep) {
         console.log(`  -> Calling triggerReveal.`);
         // Pass dependencies down (activeTimers/gameAssignments not needed for reveal)
        await triggerReveal(io, db, gameCode, gameId);
    }
}


// C:\TelestrationsGameApp\gameLogic.js

async function assignTasksAndNotify(io, db, activeTimers, gameAssignments, gameCode, gameId, nextStepType, duration, currentRound, currentStatus) {
    // Keep this entry log
     console.log(`Assigning tasks for ${nextStepType} phase (Game Status: ${currentStatus}), Round ${currentRound}`);
     // Initialize assignments for this phase for this game
     gameAssignments[gameCode] = { phase: nextStepType, assignments: {} };
     let currentPhaseAssignments = {}; // Local variable for assignments made *in this call*

    try {
        const activePlayers = await db.getActivePlayers(gameId);
        const activePlayerIds = activePlayers.map(p => p.player_id);

        // Check if there are enough players to assign tasks
        if (activePlayerIds.length < 1) { // Need at least 1 active player to assign anything
             console.warn(` -> No active players found for assignment in game ${gameCode}. Ending game?`);
             // Or should we just skip assignment and wait? Ending seems safer if no one is left.
             await db.updateGameStatus(gameId, 'finished');
             io.to(gameCode).emit('game_over', { message: 'No active players remaining.'});
             clearTimeout(activeTimers[gameCode]?.timerId); delete activeTimers[gameCode];
             if(gameAssignments[gameCode]) delete gameAssignments[gameCode];
             return;
        }

        // --- Special Case: Initial Drawing (Status: 'initial_drawing') ---
        if (currentStatus === 'initial_drawing') {
             console.log("  -> Handling assignment for initial drawing (player draws own prompt).");
             const previousStepNumber = 0; // Prompts are step 0
             const prompts = await db.getPreviousStepDataForAssignment(gameId, previousStepNumber, 'text_content');
             console.log(`  -> Found ${prompts.length} prompts for initial drawing.`);

             for (const promptStep of prompts) {
                  // Assign task back to the original player of the thread
                  const targetPlayerId = promptStep.original_player_id;
                  // Check if original player is still active
                  if (activePlayerIds.includes(targetPlayerId)) {
                        const taskData = {
                            task: 'draw', // Task type is 'draw'
                            threadId: promptStep.thread_id,
                            content: promptStep.content // The prompt text itself
                        };
                        // Store assignment: Thread -> Player
                        currentPhaseAssignments[promptStep.thread_id] = targetPlayerId;
                        // Emit task to the specific player
                        const playerSocketId = await db.getSocketId(targetPlayerId);
                        if (playerSocketId) {
                            console.log(`     Emitting 'task_draw' (Initial) to P:${targetPlayerId} (Socket:${playerSocketId}) for T:${promptStep.thread_id}`);
                            io.to(playerSocketId).emit('task_draw', taskData);
                        } else { console.warn(`     Could not find active socket for P:${targetPlayerId}. Initial draw task not sent.`); }
                  } else {
                       console.warn(`  -> Original player ${targetPlayerId} for thread ${promptStep.thread_id} is inactive. Deactivating thread.`);
                       // Deactivate thread if originator is inactive before first drawing
                       await db.deactivateThread(promptStep.thread_id);
                  }
             }
        }
        // --- Normal Assignment Logic (Status: 'guessing' or 'drawing') ---
        else {
            let previousStepNumber; let contentTypeColumn;
            if (nextStepType === 'drawing') { // Assigning Draw 2, 3... (needs Guess 1, 2...)
                previousStepNumber = currentRound * 2 - 2; // Previous step was a guess (2, 4, ...)
                contentTypeColumn = 'text_content';
            } else { // Assigning Guess 1, 2... (needs Draw 1, 2...)
                previousStepNumber = (currentRound * 2) - 1; // Previous step was a drawing (1, 3, ...)
                contentTypeColumn = 'image_content';
            }

            console.log(`  -> Fetching items from Step#: ${previousStepNumber}, Column: ${contentTypeColumn}`);
            let itemsToAssign = await db.getPreviousStepDataForAssignment(gameId, previousStepNumber, contentTypeColumn);
            console.log(`  -> Found ${itemsToAssign.length} items to assign from active threads.`);

            if (itemsToAssign.length === 0) {
                // This might happen if all threads from previous round got deactivated
                if (activePlayerIds.length > 0) { // Only end game if players are still theoretically active
                     console.error(`No items found from active threads at step ${previousStepNumber}. Ending game ${gameCode}.`);
                     io.to(gameCode).emit('error_message', 'Error: Could not find items for the next step.');
                     await db.updateGameStatus(gameId, 'finished');
                     io.to(gameCode).emit('game_over', { message: 'Could not continue, missing data from previous step.' });
                } else {
                    console.log(`No items found and no active players for assignment in ${gameCode}. Game should end.`);
                    // checkPhaseCompletion handles ending game if requiredCount becomes 0
                }
                return;
            }

            // --- Perform Assignment ---
            let availablePlayers = [...activePlayerIds]; // Players available for assignment this round
            let assignedThreads = new Set(); // Track threads assigned this round
            itemsToAssign.sort(() => Math.random() - 0.5); // Shuffle items

            for (const item of itemsToAssign) {
                if (assignedThreads.has(item.thread_id)) continue; // Should not happen if items only from active threads

                // Find eligible players (active, not the immediate previous player)
                let eligiblePlayers = availablePlayers.filter(pId => pId !== item.previous_player_id);

                // Handle cases with few players
                if (eligiblePlayers.length === 0 && availablePlayers.length > 0) {
                    // Only player left is the previous one? Allow assignment back.
                    if (availablePlayers.includes(item.previous_player_id)) {
                         eligiblePlayers = [item.previous_player_id];
                         console.warn(`G:${gameCode} T:${item.thread_id}: Forcing assign back to previous player ${item.previous_player_id} (only one available).`);
                    } else {
                         console.error(`G:${gameCode} T:${item.thread_id}: No eligible players found among available ${availablePlayers}. Skipping thread.`);
                         continue; // Skip this item/thread
                    }
                } else if (eligiblePlayers.length === 0 && availablePlayers.length === 0) {
                    console.error(`G:${gameCode} T:${item.thread_id}: No players available at all for assignment.`);
                    continue; // Skip this item/thread
                }

                // Prefer assigning to someone other than the original prompt creator
                let nonOriginatorEligible = eligiblePlayers.filter(pId => pId !== item.original_player_id);
                let assigneeId;
                if (nonOriginatorEligible.length > 0) {
                    // Assign randomly from eligible non-originators
                    assigneeId = nonOriginatorEligible[Math.floor(Math.random() * nonOriginatorEligible.length)];
                } else if (eligiblePlayers.length > 0) {
                    // If only originator is eligible (excluding previous player), assign to them
                    assigneeId = eligiblePlayers[0]; // Must be the originator
                    console.warn(`G:${gameCode} T:${item.thread_id}: Assigning back to originator ${assigneeId} (no other eligible non-previous players).`);
                } else {
                    console.error(`G:${gameCode} T:${item.thread_id}: Logic error - Could not find any assignee from eligible list.`);
                    continue; // Skip this item/thread
                }

                // Assign the task locally
                if (assigneeId) {
                    let taskContent = item.content;
                    // Convert image buffer only when assigning for a guess task
                    if (nextStepType === 'guess' && item.content instanceof Buffer) {
                        taskContent = `data:image/png;base64,${item.content.toString('base64')}`;
                    } else if (nextStepType === 'guess' && typeof item.content !== 'string') {
                        // Handle case where image content is somehow not a buffer when expecting one
                        console.error(`G:${gameCode} T:${item.thread_id}: Invalid image content type for guess task: ${typeof item.content}`);
                        taskContent = "[Error: Invalid Image Data]"; // Send placeholder
                    }

                    // Store assignment: Thread -> Player
                    currentPhaseAssignments[item.thread_id] = assigneeId;

                    // Prepare data packet for client
                    const taskData = {
                        task: nextStepType,
                        threadId: item.thread_id,
                        content: taskContent
                        // Future: Add skippedAction flag here if implementing placeholder skips
                    };

                    // Emit task to the specific player
                    const playerSocketId = await db.getSocketId(assigneeId);
                    if (playerSocketId) {
                        try {
                            const eventName = nextStepType === 'drawing' ? 'task_draw' : 'task_guess';
                            console.log(`     Emitting '${eventName}' to P:${assigneeId} (Socket:${playerSocketId}) for T:${item.thread_id}`);
                            io.to(playerSocketId).emit(eventName, taskData);
                        } catch (emitError) { console.error(`     !!!! ERROR during emit to P:${assigneeId} (Socket:${playerSocketId}):`, emitError); }
                    } else { console.warn(`     Could not find active socket for P:${assigneeId}. Task not sent.`); }

                    // Update available players list
                    availablePlayers = availablePlayers.filter(pId => pId !== assigneeId);
                    assignedThreads.add(item.thread_id);
                } else {
                    // Should not happen if logic above is correct
                    console.error(`G:${gameCode} T:${item.thread_id}: Failed to determine assigneeId after eligibility checks.`);
                    continue;
                }

                // Check if we ran out of players prematurely
                if (availablePlayers.length === 0 && assignedThreads.size < itemsToAssign.length) {
                    console.error(`G:${gameCode}: Ran out of players to assign to remaining ${itemsToAssign.length - assignedThreads.size} threads!`);
                    // Consider deactivating remaining threads?
                }
            } // end for loop over itemsToAssign
        } // end else (normal assignment)

        // Store the final assignments for this phase in the shared state object
        gameAssignments[gameCode] = { phase: nextStepType, assignments: currentPhaseAssignments };
        console.log(`  -> Assignment complete. Stored assignments for ${Object.keys(currentPhaseAssignments).length} tasks.`);

        // Start the timer for the phase that was just assigned
        // Determine correct timer phase name based on the action assigned
        const timerPhaseName = (currentStatus === 'initial_drawing' || nextStepType === 'drawing') ? 'drawing' : 'guessing';
        console.log(`  -> Starting timer for phase '${timerPhaseName}' duration ${duration}s`);
        // Call startPhaseTimer from this module, passing dependencies
        startPhaseTimer(io, activeTimers, db, gameCode, gameId, timerPhaseName, duration);

    } catch (err) {
        console.error(`Error assigning tasks for ${nextStepType} in ${gameCode}:`, err);
         io.to(gameCode).emit('error_message', 'Internal error during task assignment.');
    }
}

// MODIFY triggerReveal in gameLogic.js
async function triggerReveal(io, db, gameCode, gameId) { // Removed activeTimers dependency
     console.log(`Triggering reveal phase for game ${gameCode}`);
    try {
        // getRevealData likely needs modification to filter t.is_active=1 in db.js
        const finalRevealData = await db.getRevealData(gameId);
        const game = await db.getGameSettings(gameId);

        io.to(gameCode).emit('reveal_data', { threads: finalRevealData });
        console.log(`Reveal data sent for game ${gameCode} (${finalRevealData.length} active threads).`);

        if (game && game.status !== 'finished') {
             await db.updateGameStatus(gameId, 'finished');
             console.log(`Game ${gameCode} status updated to finished.`);
        }
        // Broadcast requires io and db
        await helpers.broadcastWaitingGames(io, db);

    } catch (err) {
        console.error(`Error triggering reveal for game ${gameCode}:`, err);
        io.to(gameCode).emit('error_message', 'Failed to load reveal data.');
        // Attempt broadcast even on error
        await helpers.broadcastWaitingGames(io, db);
    }
}

// Export the functions to be used by socketHandlers.js
module.exports = {
    checkPhaseCompletion,
    transitionToNextPhase,
    assignTasksAndNotify,
    triggerReveal,
    startPhaseTimer // Export startPhaseTimer as well
};