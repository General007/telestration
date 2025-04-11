// C:\TelestrationsGameApp\public\js\client.js

// --- Module Imports ---
// Import functions for updating the DOM
import {
    showScreen, showError, clearError, updateWaitingRoomUI,
    showWaitingMessage, updateTimerDisplay, clearTimerDisplay,
    renderReveal, renderActiveGames, renderTaskUI
} from './uiUpdater.js';

// Import functions for managing the canvas
import {
    setupCanvas, getDrawingData, setCanvasDrawingMode
} from './canvasManager.js';

// Import functions for handling user actions and locking UI
import {
    lockUIForTask, unlockUIForTask, submitPrompt,
    submitDrawing, submitGuess, requestRandomPrompt
} from './gameActions.js';

// --- Main Event Listener ---
document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const DEBUG_MODE = true;
    const DEBUG_GAME_CODE = 'DEBUG';

    // --- Socket Connection ---
    const socket = io({
        // transports: ['polling'] // Optional: Force polling for testing/stability
    });

    // --- State Variables ---
    // Core game/player state managed here
    let playerId = null;
    let playerName = null;
    let gameCode = null;
    let gameId = null;
    let isGameMaster = false;
    let currentTask = null;       // Tracks the current phase ('prompt', 'draw', 'guess')
    let currentThreadId = null;  // ID of the thread the player is working on
    let fabricCanvas = null;    // Reference to the active Fabric.js canvas instance
    let clientTimerInterval = null; // ID for the visual countdown interval timer
    let submissionMade = false; // Flag: Has the user submitted for the current task?
    let activityDetectedThisPhase = false; // Added flag for user interaction

    // --- UI Elements Cache ---
    // Get references to major UI containers and elements once
    const ui = {
        loginScreen: document.getElementById('loginScreen'),
        waitingRoom: document.getElementById('waitingRoom'),
        gameScreen: document.getElementById('gameScreen'),
        revealScreen: document.getElementById('revealScreen'),
        errorMessage: document.getElementById('errorMessage'),
        playerNameInput: document.getElementById('playerName'),
        gameCodeInput: document.getElementById('gameCodeInput'),
        joinGameBtn: document.getElementById('joinGameBtn'), // Manual join button
        activeGamesList: document.getElementById('activeGamesList'), // List for games
        displayGameCode: document.getElementById('displayGameCode'), // In waiting room
        playerList: document.getElementById('playerList'),         // In waiting room
        startGameBtn: document.getElementById('startGameBtn'),       // In waiting room
        waitingRoomMessage: document.querySelector('#waitingRoom .waiting-message'),
        timerDisplay: document.getElementById('timerDisplay'),     // In game screen
        taskArea: document.getElementById('taskArea'),         // In game screen
        waitingMessage: document.getElementById('waitingMessage'), // In game screen
        revealContent: document.getElementById('revealContent'),   // In reveal screen
    };

    // --- Utility Functions ---
    // Escape HTML utility needed by some UI rendering functions
    // IMPORTANT: Verify entities like & are correct in your editor after pasting
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') { return ''; }
        return unsafe
             .replace(/&/g, "&amp;")  // Replace & with &
             .replace(/</g, "&lt;")   // Replace < with <
             .replace(/>/g, "&gt;")   // Replace > with >
             .replace(/"/g, "&quot;") // Replace " with "
             .replace(/'/g, "&#039;"); // Replace ' with ' (or ')
     }

     // Client-side visual timer management
     function startClientTimer(duration) {
        if (clientTimerInterval) {
            clearInterval(clientTimerInterval); // Clear previous interval
        }
        clientTimerInterval = null; // Reset interval ID
        let timeLeft = duration;
        updateTimerDisplay(timeLeft, ui); // Call imported UI function

        clientTimerInterval = setInterval(() => {
            timeLeft--;
            updateTimerDisplay(timeLeft, ui); // Update display each second
            if (timeLeft <= 0) {
                // Stop the interval when time runs out
                clearInterval(clientTimerInterval);
                clientTimerInterval = null;
                console.log("Client: Visual timer reached zero.");
                // Note: Server 'times_up' event is the authority for actual phase end
            }
        }, 1000);
    }

    // --- Event Listeners (UI) ---

    // Listener for the MANUAL join button
    if (ui.joinGameBtn && ui.gameCodeInput) {
        ui.joinGameBtn.addEventListener('click', () => {
            const currentName = ui.playerNameInput?.value.trim();
            const code = ui.gameCodeInput?.value.trim().toUpperCase();

            if (currentName && code) {
                playerName = currentName; // Update state variable
                console.log(`Client: Attempting manual join -> Name: ${playerName}, Code: ${code}`);
                socket.emit('join_game', { playerName, gameCode: code });
                clearError(ui); // Use imported function
            } else if (!currentName) {
                showError('Please enter your name.', ui); // Use imported function
            } else {
                showError('Please enter a game code.', ui); // Use imported function
            }
        });
    }

    // Listener for dynamic Join buttons in the game list (using Event Delegation)
    if (ui.activeGamesList) {
        ui.activeGamesList.addEventListener('click', (event) => {
            // Target the button specifically
            const joinButton = event.target.closest('.join-game-list-btn');
            if (joinButton) {
                event.preventDefault(); // Prevent any default button behavior
                const gameCodeToJoin = joinButton.getAttribute('data-game-code');
                const currentName = ui.playerNameInput?.value.trim();
                console.log("Client: Player name for list join:", currentName);

                if (currentName && gameCodeToJoin) {
                    playerName = currentName; // Update state variable
                    console.log(`Client: Attempting list join -> Name: ${playerName}, Code: ${gameCodeToJoin}`);
                    joinButton.disabled = true; // Disable the specific button clicked
                    joinButton.textContent = 'Joining...';

                    console.log(`Client: Socket connected status before list join emit: ${socket.connected}`);
                    if (socket.connected) {
                        console.log("Client: --> About to emit join_game from list");
                        socket.emit('join_game', { playerName, gameCode: gameCodeToJoin });
                        console.log("Client: --> Finished emit join_game call from list");
                        // Let server response ('game_joined' or 'error_message') handle UI changes
                    } else {
                        console.error("Client: Socket is not connected. Cannot send join event.");
                        showError("Connection error. Cannot join game.", ui);
                        joinButton.disabled = false; // Re-enable button on immediate error
                        joinButton.textContent = 'Join';
                    }
                } else if (!currentName) {
                    showError('Please enter your name first.', ui);
                    ui.playerNameInput?.focus();
                    // No need to re-enable button here, it wasn't disabled yet
                } else {
                     console.error("Client: Could not get game code from button:", joinButton);
                     showError("Could not join game (internal error).", ui);
                     // No need to re-enable button here, it wasn't disabled yet
                }
            } // end if joinButton
        }); // end addEventListener
    } else {
        console.warn("Client: Active games list element not found for attaching listener.");
    }

    // Start Game Button (only visible/enabled for GM in waiting room)
    if (ui.startGameBtn) {
        ui.startGameBtn.addEventListener('click', () => {
            if (isGameMaster && gameCode && playerId) {
                console.log(`Client: GM ${playerId} starting game ${gameCode}`);
                socket.emit('start_game', { gameCode, playerId });
                ui.startGameBtn.disabled = true; // Disable after click
                clearError(ui);
            } else {
                console.warn("Client: Start game clicked but conditions not met.", { isGameMaster, gameCode, playerId });
            }
        });
    }

    // Task Area Buttons (Submit/Random - Event Delegation)
    if (ui.taskArea) {
        ui.taskArea.addEventListener('click', (event) => {
            const targetButton = event.target.closest('button'); // Find the button clicked
            if (!targetButton) return; // Exit if click wasn't on or inside a button

            const targetId = targetButton.id;

            // Call imported action functions, passing necessary state/helpers
            if (targetId === 'submitPromptBtn') {
                submitPrompt(socket, gameCode, playerId, (msg) => showError(msg, ui));
                // Note: submissionMade state is set by 'submission_received' handler
            } else if (targetId === 'submitDrawingBtn') {
                submitDrawing(socket, gameCode, playerId, currentThreadId, getDrawingData, (msg) => showError(msg, ui), fabricCanvas);
            } else if (targetId === 'submitGuessBtn') {
                submitGuess(socket, gameCode, playerId, currentThreadId, (msg) => showError(msg, ui));
            } else if (targetId === 'randomPromptBtn') {
                targetButton.disabled = true; // Disable immediately
                requestRandomPrompt(socket);
                // Re-enable logic is now within the 'random_prompt_result' handler
            }
        });
    } else {
        console.error("Client: Task area element not found for attaching listener.");
    }

    // --- Socket Event Handlers ---

    socket.on('connect', () => {
        console.log('Client: Connected to server:', socket.id);
        clearError(ui);
        // Attempt rejoin if applicable
        const lastPlayerName = playerName || (DEBUG_MODE ? `Debugger_${Math.floor(Math.random() * 1000)}` : '');
        if (gameCode && lastPlayerName && !playerId) { // Check if we have game context but lost player ID
            console.log(`Client: Reconnecting. Attempting rejoin game ${gameCode} as ${lastPlayerName}...`);
            if (!playerName) playerName = lastPlayerName; // Ensure state variable is set
            socket.emit('join_game', { playerName, gameCode });
        } else if (DEBUG_MODE && !playerId && !gameCode) {
            console.log("Client: DEBUG MODE: Connected, waiting for user action on login screen.");
        }
        // Server sends active_games_list automatically on connection now
    });

    socket.on('disconnect', (reason) => {
        console.log('Client: Disconnected:', reason);
        showError('Lost connection. Attempting to reconnect...', ui);
        clearTimerDisplay(ui); // Use imported function
        // Reset state potentially?
        // playerId = null; // Maybe don't nullify immediately for rejoin
        // isGameMaster = false; currentTask = null; etc.
    });

    socket.on('error_message', (message) => {
        console.error("Client: Received error message:", message);
        showError(message, ui); // Use imported function
        // Re-enable relevant buttons that might have been disabled during the failed action
        if (ui.activeGamesList) {
            ui.activeGamesList.querySelectorAll('.join-game-list-btn:disabled').forEach(btn => {
                btn.disabled = false;
                btn.textContent = 'Join';
            });
        }
        if (ui.startGameBtn && isGameMaster && ui.playerList) {
            ui.startGameBtn.disabled = ui.playerList.querySelectorAll('li').length < 2;
        }
        // If an error happens during a task, potentially unlock UI? Depends on error.
        // if (currentTask) unlockUIForTask(currentTask, fabricCanvas);
    });

    socket.on('game_joined', (data) => {
         console.log('Client: Joined Game:', data);
         // Update core client state
         playerId = data.playerId;
         playerName = data.playerName; // Use name confirmed by server
         gameCode = data.gameCode;
         gameId = data.gameId;
         isGameMaster = data.isGameMaster;
         clearError(ui); // Clear any previous login errors

         console.log(`Client: Joined game ${gameCode} as ${playerName} (PlayerID: ${playerId}, GM: ${isGameMaster}). Status: ${data.gameStatus}`);
         // Use imported functions to update UI based on game status
         if (data.gameStatus === 'waiting') {
             updateWaitingRoomUI(gameCode, data.players, playerId, isGameMaster, ui, escapeHtml); // Pass dependencies
             showScreen('waitingRoom', ui);
         }
         else if (data.gameStatus === 'revealing' || data.gameStatus === 'finished') {
             console.log("Client: Joined finished/revealing game.");
             showScreen('revealScreen', ui);
             if(ui.revealContent) ui.revealContent.innerHTML = `<p class="waiting-message">Game finished.</p>`;
         }
         else { // Game is in progress
             updateWaitingRoomUI(gameCode, data.players, playerId, isGameMaster, ui, escapeHtml); // Update state anyway
             showScreen('gameScreen', ui);
             showWaitingMessage(true, ui); // Show waiting message until task arrives
             console.log("Client: Joined mid-game.");
         }
     });

    socket.on('active_games_list', (games) => {
         console.log("Client: Received active games list:", games);
         // Use imported function to render list, but only if login screen is active
         if (ui.loginScreen && !ui.loginScreen.classList.contains('hidden')) {
             renderActiveGames(games, ui, escapeHtml); // Pass dependencies
         } else {
             console.log("Client: Login screen not visible, not rendering game list update.");
         }
     });

    socket.on('player_joined', (data) => {
        console.log('Client: Player Joined event received:', data.players);
        // Use imported function to update waiting room UI if visible
        if (ui.waitingRoom && !ui.waitingRoom.classList.contains('hidden')) {
            updateWaitingRoomUI(gameCode, data.players, playerId, isGameMaster, ui, escapeHtml); // Pass dependencies
        }
    });

    socket.on('player_left', (data) => {
        console.log('Client: Player Left event received:', data.playerId, data.players);
        // Use imported function to update waiting room UI if visible
        if (ui.waitingRoom && !ui.waitingRoom.classList.contains('hidden')) {
            updateWaitingRoomUI(gameCode, data.players, playerId, isGameMaster, ui, escapeHtml); // Pass dependencies
        }
        if (ui.gameScreen && !ui.gameScreen.classList.contains('hidden')) {
            console.log(`Client: Player ID ${data.playerId} left during the game.`);
            // Potentially show a notification here?
        }
    });

    socket.on('game_started', (data) => {
        console.log('Client: Game Started signal!', data.players);
        // Could update player state based on data.players if needed
        showScreen('gameScreen', ui);
        clearError(ui);
        // Expecting task_prompt event next
    });

    socket.on('task_prompt', () => {
        console.log('Client: Received task: Prompt');
        currentTask = 'prompt';
        currentThreadId = null;
        submissionMade = false;
        activityDetectedThisPhase = false;
        showWaitingMessage(false, ui);
        renderTaskUI('prompt', null, ui, escapeHtml); // Use imported function
        clearTimerDisplay(ui);
        // Use imported function to unlock, slight delay for DOM render
        setTimeout(() => { unlockUIForTask('prompt', null); }, 50);
        const promptInputEl = document.getElementById('promptInput');
        if (promptInputEl) {
            // Define listener function
            const promptActivityListener = () => {
                console.log("Activity detected: Prompt input");
                activityDetectedThisPhase = true;
                // Optional: Remove listener after first activity if needed
                // promptInputEl.removeEventListener('input', promptActivityListener);
            };
            // Attach listener (consider using .once or managing removal)
            promptInputEl.addEventListener('input', promptActivityListener, { once: true }); // Using once simplifies removal
        }
    });

    socket.on('random_prompt_result', (data) => {
        console.log('Client: Received random prompt result.');
        const promptInput = document.getElementById('promptInput');
        if (promptInput && data.prompt) {
            promptInput.value = data.prompt;
        } else if (!promptInput) {
             console.warn("Client: Prompt input not found for random result.");
        }
        // Re-enable button after getting result
        const randomBtn = document.getElementById('randomPromptBtn');
        if (randomBtn) {
            randomBtn.disabled = false;
        }
    });

    socket.on('task_draw', (data) => {
        console.log('Client: Received task: Draw'); // Log received data? Careful if large
        currentTask = 'draw';
        currentThreadId = data.threadId; // Store thread ID for submission
        submissionMade = false;
        activityDetectedThisPhase = false;
        showWaitingMessage(false, ui);
        renderTaskUI('draw', data, ui, escapeHtml); // Render draw UI
        fabricCanvas = setupCanvas(ui.taskArea); // Setup canvas, store instance
        clearTimerDisplay(ui);
        // Use imported function to unlock, slight delay
        setTimeout(() => { unlockUIForTask('drawing', fabricCanvas); }, 50); // Pass canvas instance
        if (fabricCanvas) { // Make sure canvas instance exists
            // Define listener function
            const canvasActivityListener = (options) => {
                 // 'path:created' fires after a drawing stroke is completed
                 // 'mouse:down' fires on click/touch start
                console.log("Activity detected: Canvas interaction");
                activityDetectedThisPhase = true;
                 // Optional: Remove listener after first activity
                 // fabricCanvas.off('path:created', canvasActivityListener);
                 // fabricCanvas.off('mouse:down', canvasActivityListener);
            };
             // Attach listener (use .once if suitable for Fabric events, or manage removal)
            fabricCanvas.once('path:created', canvasActivityListener);
            fabricCanvas.once('mouse:down', canvasActivityListener); // Also detect initial click/touch
        }
    });

    socket.on('task_guess', (data) => {
        console.log('Client: Received task: Guess'); // Log received data? Careful if image data large
        currentTask = 'guess';
        currentThreadId = data.threadId; // Store thread ID
        submissionMade = false;
        activityDetectedThisPhase = false;
        showWaitingMessage(false, ui);
        renderTaskUI('guess', data, ui, escapeHtml); // Render guess UI
        clearTimerDisplay(ui);
        // Use imported function to unlock, slight delay
        setTimeout(() => { unlockUIForTask('guessing', null); }, 50); // Pass null for canvas
        const guessInputEl = document.getElementById('guessInput');
        if (guessInputEl) {
            // Define listener function
            const guessActivityListener = () => {
                console.log("Activity detected: Guess input");
                activityDetectedThisPhase = true;
                // Optional: Remove listener after first activity
                // guessInputEl.removeEventListener('input', guessActivityListener);
            };
            // Attach listener
            guessInputEl.addEventListener('input', guessActivityListener, { once: true });
        }
    });

    socket.on('start_timer', (data) => {
        if (data.phase && typeof data.duration === 'number') {
            console.log(`Client: Timer started signal - Phase: ${data.phase}, Duration: ${data.duration}s`);
            startClientTimer(data.duration); // Use local timer function
        } else {
            console.warn("Client: Invalid start_timer event received:", data);
        }
    });

    socket.on('times_up', (data) => {
        if (!data.phase) { console.warn("Client: Received times_up event without phase"); return; }
        console.log("Client: Time's up signal for phase:", data.phase);
        if (clientTimerInterval) clearInterval(clientTimerInterval);
        clientTimerInterval = null; // Clear interval ID
        if(ui.timerDisplay) ui.timerDisplay.textContent = "Time's Up!";

        // Use imported function to lock UI, pass canvas instance
        lockUIForTask(data.phase, true, fabricCanvas);

        // Auto-submit drawing ONLY if user interacted with the canvas
        if (data.phase === 'drawing' && currentTask === 'draw' && !submissionMade) {
            if (activityDetectedThisPhase) {
                console.log("Client: Time's up + Activity detected. Auto-submitting drawing...");
                // Call imported action function, which will set submissionMade on attempt
                submitDrawing(socket, gameCode, playerId, currentThreadId, getDrawingData, (msg) => showError(msg, ui), fabricCanvas);
                // Note: submitDrawing handles locking the UI
            } else {
                console.log("Client: Time's up but NO activity detected. Drawing not submitted by client.");
                // UI is already locked by lockUIForTask call above this block in the original handler.
                // Show waiting message as submission didn't happen.
                showWaitingMessage(true, ui);
            }
        } else if (!submissionMade && currentTask === data.phase) {
            // Time ran out for a phase (like prompt/guess) we were on, but no auto-submit logic here.
            // UI already locked by lockUIForTask above. Show waiting message.
            console.log(`Client: Time ran out for ${data.phase} before submission.`);
            showWaitingMessage(true, ui);
        } else {
            // Time up for a phase we aren't currently on, or we already submitted
            console.log(`Client: Time up for ${data.phase}, but current task is ${currentTask} or submission already made. No client action needed.`);
        }
    });

    // Listener for server confirming receipt of a submission
    socket.on('submission_received', (data) => {
        // Validate incoming data
        if (!data || typeof data.type !== 'string') {
             console.warn("Client: Received invalid submission_received event:", data);
             return; // Ignore invalid event
        }

        console.log(`Client: Submission confirmed by server for task type: ${data.type}.`);
        submissionMade = true; // Mark current task as submitted

        // Lock the UI elements corresponding to the confirmed submission type
        // Pass canvas instance needed for drawing lock
        lockUIForTask(data.type, true, fabricCanvas); // Use imported function

        // Check if the confirmed type matches the client's current task state.
        // This is mostly for debugging potential race conditions or state mismatches.
        if (currentTask !== data.type) {
             console.warn(`Client: Server confirmed submission for '${data.type}', but current client task was '${currentTask}'.`);
             // Optional: Force lock the UI for currentTask as well? Might be overly aggressive.
             // if (currentTask) { lockUIForTask(currentTask, true, fabricCanvas); }
        }

        // Show the generic "Waiting for others..." message
        showWaitingMessage(true, ui); // Use imported function
        // Clear the timer display (as the timer for this phase is now irrelevant)
        clearTimerDisplay(ui); // Use imported function
    });

    // Listener for receiving the final reveal data from the server
    socket.on('reveal_data', (data) => {
        console.log('Client: Reveal data received');

        // Ensure critical UI elements are accessible
        if (!ui.revealScreen || !ui.revealContent) {
            console.error("Client: Reveal screen or content area not found. Cannot display reveal.");
            showError("Error displaying results.", ui); // Show generic error
            return;
        }

        // Prepare the UI for reveal
        showScreen('revealScreen', ui);    // Switch to the reveal screen
        clearError(ui);                // Clear any previous errors
        clearTimerDisplay(ui);         // Clear any leftover timer display

        // Check if the received data structure is valid (has a threads array)
        if (data && Array.isArray(data.threads)) {
            // Call the imported rendering function, passing necessary arguments
            renderReveal(data.threads, ui, escapeHtml);
        } else {
            // Handle cases where data is missing or malformed
            console.error("Client: Reveal data received but 'threads' array is missing or invalid.", data);
            ui.revealContent.innerHTML = '<p class="waiting-message">Error: Could not load reveal data properly.</p>';
            showError("Failed to load reveal results.", ui); // Also show error bar
        }
    });

    // Listener for game ending prematurely (e.g., no active threads, error)
    socket.on('game_over', (data) => {
        // Use message from server or a default
        const message = data?.message || "The game ended unexpectedly.";
        console.log('Client: Game Over event received:', message);

        // Ensure reveal screen UI elements are available
        if (!ui.revealScreen || !ui.revealContent) {
             console.error("Client: Cannot display game over message - reveal screen/content element not found.");
             showError(`Game Over: ${message}`, ui); // Fallback to general error display
             clearTimerDisplay(ui);
             return;
        }

        // Ensure reveal screen is shown
        showScreen('revealScreen', ui);

        // Create and prepend the game over message to the reveal content area
        const gameOverMsg = document.createElement('div');
        gameOverMsg.innerHTML = `<h2>Game Over</h2><p class="waiting-message">${escapeHtml(message)}</p><hr>`;
        ui.revealContent.prepend(gameOverMsg); // Add message to the top

        clearTimerDisplay(ui); // Clear any running timers
        // Optionally: Disable any remaining active controls if needed
        // if (currentTask) lockUIForTask(currentTask, true, fabricCanvas);
    });

    // --- Initial Setup ---
    // Run on page load

    // Clear any previous state indicators
    clearError(ui);
    clearTimerDisplay(ui);

    // Check sessionStorage for data passed from admin page redirect
    const autoJoinDataString = sessionStorage.getItem('autoJoinGame');
    let autoJoinData = null; // Initialize as null

    if (autoJoinDataString) {
        try {
            autoJoinData = JSON.parse(autoJoinDataString);
            // IMPORTANT: Clear the item immediately after reading to prevent reuse on refresh
            sessionStorage.removeItem('autoJoinGame');
            console.log("Client: Found auto-join data from sessionStorage:", autoJoinData);
        } catch (e) {
            console.error("Client: Error parsing auto-join data:", e);
            sessionStorage.removeItem('autoJoinGame'); // Clear invalid data
            autoJoinData = null; // Ensure it's null if parsing failed
        }
    }

    // Proceed if auto-join data is valid
    if (autoJoinData?.gameCode && autoJoinData?.playerId) {
         // Auto-join scenario (client was redirected from admin page after creating game)
         console.log(`Client: Auto-joining game ${autoJoinData.gameCode} as GM (PlayerID: ${autoJoinData.playerId}).`);

         // Set client state variables directly from the parsed data
         playerId = autoJoinData.playerId;
         playerName = autoJoinData.playerName;
         gameCode = autoJoinData.gameCode;
         gameId = autoJoinData.gameId;
         isGameMaster = true; // Creator is always GM in this flow

         // Emit join_game event after a short delay.
         // This is crucial to sync the new socket ID with the existing player record
         // created on the server during the 'create_game' step, and to join the Socket.IO room.
         setTimeout(() => {
            if (socket.connected) {
                console.log(`Client: Emitting join_game to sync server socket for auto-join.`);
                // Server treats this as a rejoin because player record exists
                socket.emit('join_game', { playerName, gameCode });
            } else {
                console.warn(`Client: Socket not connected yet for auto-join sync. Relying on 'connect' handler to attempt rejoin.`);
                // The 'connect' handler has logic to attempt rejoin if gameCode/playerName are set
            }
         }, 150); // Slightly longer delay might be safer

         // Immediately show the waiting room UI using the data passed from admin page
         // Pass all necessary parameters to the imported UI function
         updateWaitingRoomUI(gameCode, autoJoinData.players || [], playerId, isGameMaster, ui, escapeHtml);
         showScreen('waitingRoom', ui);

    } else {
         // Normal startup or failed auto-join: Show login screen
         console.log("Client: No valid auto-join data found, showing login screen.");

         // Set DEBUG defaults in UI fields if mode is enabled
         if (DEBUG_MODE) {
             console.log("Client: DEBUG MODE: Setting default values for login screen.");
             // Set default name only if not already set (e.g. from previous failed rejoin attempt)
             if (!playerName) {
                 playerName = `Debugger_${Math.floor(Math.random() * 1000)}`;
             }
             if (ui.playerNameInput) {
                 ui.playerNameInput.value = playerName;
             }
             // Pre-fill game code input for convenience in debug mode
             if (ui.gameCodeInput) {
                 ui.gameCodeInput.value = DEBUG_GAME_CODE;
             }
         }
         // Show the login screen
         showScreen('loginScreen', ui); // Use imported function
         // Server will push the initial game list via 'active_games_list' on connection
    }

}); // --- End DOMContentLoaded ---