// C:\TelestrationsGameApp\public\js\gameActions.js

/**
 * This module handles user actions that trigger game events (submitting data)
 * and manages locking/unlocking the relevant UI sections during these actions.
 * It expects dependencies like the socket object and UI update functions to be passed in.
 */

// --- UI Locking/Unlocking Functions ---

/**
 * Locks or unlocks UI elements associated with a specific game phase.
 * @param {string} taskPhase - 'prompt', 'drawing', or 'guessing'.
 * @param {boolean} lock - True to lock (disable), false to unlock (enable).
 * @param {fabric.Canvas | null} [fabricCanvas=null] - Optional Fabric canvas instance (needed for locking drawing mode).
 */
function lockUIForTask(taskPhase, lock = true, fabricCanvas = null) {
    const action = lock ? 'Locking' : 'Unlocking';
    console.log(`Game Actions: ${action} UI for task: ${taskPhase}`);
    const disable = lock; // Use 'disable' variable for clarity (true means disabled)

    if (taskPhase === 'prompt') {
        const promptInput = document.getElementById('promptInput');
        const submitBtn = document.getElementById('submitPromptBtn');
        const randomBtn = document.getElementById('randomPromptBtn');
        // Safely disable/enable elements if they exist
        if (promptInput) promptInput.disabled = disable;
        if (submitBtn) submitBtn.disabled = disable;
        if (randomBtn) randomBtn.disabled = disable;

    } else if (taskPhase === 'drawing') {
        // Lock/unlock Fabric canvas drawing mode if instance is provided
        if (fabricCanvas) {
            try {
                fabricCanvas.isDrawingMode = !disable; // Disable drawing mode when locked (lock=true -> isDrawingMode=false)
                fabricCanvas.selection = !disable; // Disable object selection when locked
                fabricCanvas.forEachObject(obj => obj.selectable = !disable); // Make objects non-selectable
                fabricCanvas.renderAll(); // Apply visual changes
                console.log(` -> Canvas drawing mode set to ${!disable}`);
            } catch(e) {
                 console.error("Game Actions: Error setting canvas drawing mode:", e);
            }
        } else if (lock === false && document.getElementById('drawingCanvas')) {
            // If unlocking and canvas element exists but instance wasn't passed/ready
            console.warn("Game Actions: Attempted to unlock drawing canvas, but instance not provided/ready.");
        }

        // Lock/unlock standard HTML controls
        const submitBtn = document.getElementById('submitDrawingBtn');
        const clearBtn = document.getElementById('dClear');
        const colorPicker = document.getElementById('dColor');
        const sizeSlider = document.getElementById('dSize');
        if (submitBtn) submitBtn.disabled = disable;
        if (clearBtn) clearBtn.disabled = disable;
        if (colorPicker) colorPicker.disabled = disable;
        if (sizeSlider) sizeSlider.disabled = disable;

    } else if (taskPhase === 'guessing') {
        const guessInput = document.getElementById('guessInput');
        const submitBtn = document.getElementById('submitGuessBtn');
        if (guessInput) guessInput.disabled = disable;
        if (submitBtn) submitBtn.disabled = disable;

    } else {
        // Log if called with an unexpected phase name
        console.warn(`Game Actions: lockUIForTask called with unknown task phase: ${taskPhase}`);
    }
}

/**
 * Convenience function to unlock UI elements for a specific task phase.
 * @param {string} taskPhase - 'prompt', 'drawing', or 'guessing'.
 * @param {fabric.Canvas | null} [fabricCanvas=null] - Optional Fabric canvas instance.
 */
function unlockUIForTask(taskPhase, fabricCanvas = null) {
    // Calls lockUIForTask with lock set to false
    lockUIForTask(taskPhase, false, fabricCanvas);
}


// --- Game Action Functions (Emit events to server) ---
// These functions encapsulate the logic for sending data based on user interaction.
// They require the 'socket' object, current game state (gameCode, playerId, etc.),
// and potentially other helper functions (like showError, getDrawingData) passed as arguments.

/**
 * Handles submitting the prompt text. Locks UI and emits event.
 * @param {object} socket - The Socket.IO client instance.
 * @param {string} gameCode - The current game code.
 * @param {number} playerId - The current player's ID.
 * @param {function} showError - Function reference to display errors (e.g., from uiUpdater).
 * @returns {boolean} True if submission was attempted, false if input was empty.
 */
function submitPrompt(socket, gameCode, playerId, showError) {
    const promptInput = document.getElementById('promptInput');
    const promptText = promptInput?.value.trim();

    if (promptText) {
        lockUIForTask('prompt', true); // Lock UI before emitting
        console.log("Game Actions: Emitting submit_prompt");
        socket.emit('submit_prompt', { gameCode, playerId, promptText });
        // Note: submissionMade state is managed in client.js based on 'submission_received'
        return true; // Indicate submission was attempted
    } else {
        // Show error using the passed function
        if (typeof showError === 'function') {
            showError('Prompt cannot be empty.');
        }
        console.log("Game Actions: SubmitPrompt failed - empty text.");
        return false; // Indicate submission failed validation
    }
}

/**
 * Handles submitting the drawing. Locks UI, gets data, and emits event.
 * @param {object} socket - The Socket.IO client instance.
 * @param {string} gameCode - The current game code.
 * @param {number} playerId - The current player's ID.
 * @param {number} threadId - The current thread ID for this drawing.
 * @param {function} getDrawingDataFunc - Function reference to get canvas data (e.g., from canvasManager).
 * @param {function} showError - Function reference to display errors.
 * @param {fabric.Canvas | null} fabricCanvas - The Fabric canvas instance (for unlock on failure).
 * @returns {boolean} True if submission was attempted, false if drawing data was unavailable.
 */
function submitDrawing(socket, gameCode, playerId, threadId, getDrawingDataFunc, showError, fabricCanvas) {
    // Ensure the function to get data is valid
    if (typeof getDrawingDataFunc !== 'function') {
        console.error("Game Actions: Invalid getDrawingDataFunc passed to submitDrawing.");
        if (typeof showError === 'function') showError("Internal error: Cannot get drawing data.");
        return false;
    }

    const drawingDataUrl = getDrawingDataFunc(); // Call the function passed from canvasManager

    if (drawingDataUrl) {
        lockUIForTask('drawing', true, fabricCanvas); // Lock UI before emitting
        console.log("Game Actions: Emitting submit_drawing");
        socket.emit('submit_drawing', { gameCode, playerId, drawingDataUrl, threadId });
        return true; // Indicate submission was attempted
    } else {
        // Handle failure to get drawing data
        if (typeof showError === 'function') {
            showError("Could not get drawing data to submit. Please try again.");
        }
        console.log("Game Actions: SubmitDrawing failed - no drawing data returned from canvas manager.");
        // Re-unlock UI if submit failed due to export error
        unlockUIForTask('drawing', fabricCanvas);
        return false; // Indicate submission failed
    }
}

/**
 * Handles submitting the guess text. Locks UI and emits event.
 * @param {object} socket - The Socket.IO client instance.
 * @param {string} gameCode - The current game code.
 * @param {number} playerId - The current player's ID.
 * @param {number} threadId - The current thread ID for this guess.
 * @param {function} showError - Function reference to display errors.
 * @returns {boolean} True if submission was attempted, false if input was empty.
 */
function submitGuess(socket, gameCode, playerId, threadId, showError) {
    const guessInput = document.getElementById('guessInput');
    const guessText = guessInput?.value.trim();

    if (guessText) {
        lockUIForTask('guessing', true); // Lock UI before emitting
        console.log("Game Actions: Emitting submit_guess");
        socket.emit('submit_guess', { gameCode, playerId, guessText, threadId });
        return true; // Indicate submission was attempted
    } else {
        if (typeof showError === 'function') {
            showError('Guess cannot be empty.');
        }
        console.log("Game Actions: SubmitGuess failed - empty text.");
        return false; // Indicate submission failed validation
    }
}

/**
 * Handles requesting a random prompt idea from the server.
 * @param {object} socket - The Socket.IO client instance.
 */
function requestRandomPrompt(socket) {
    console.log("Game Actions: Emitting get_random_prompt");
    socket.emit('get_random_prompt');
    // Note: Button disabling/re-enabling is handled in client.js listeners
}


// --- Module Exports ---
export {
    lockUIForTask,
    unlockUIForTask,
    submitPrompt,
    submitDrawing,
    submitGuess,
    requestRandomPrompt
};