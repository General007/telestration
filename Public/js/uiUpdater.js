// C:\TelestrationsGameApp\public\js\uiUpdater.js

/**
 * This module exports functions dedicated to updating the game's UI (DOM manipulation).
 * It helps separate display logic from the core client-side game logic in client.js.
 * Functions generally expect the 'ui' cache object and sometimes the 'escapeHtml' utility.
 */

// --- Exported UI Update Functions ---

/**
 * Shows the specified screen element (by ID) and hides the others known to the ui cache.
 * @param {string} screenId - The ID of the screen element to show.
 * @param {object} ui - The cache object containing references to screen elements.
 */
function showScreen(screenId, ui) {
    console.log(`UI_Updater: Showing screen: ${screenId}`);

    // Hide all known major screen containers
    if (ui.loginScreen) ui.loginScreen.classList.add('hidden');
    if (ui.waitingRoom) ui.waitingRoom.classList.add('hidden');
    if (ui.gameScreen) ui.gameScreen.classList.add('hidden');
    if (ui.revealScreen) ui.revealScreen.classList.add('hidden');

    // Attempt to find and show the target screen
    const screenToShow = document.getElementById(screenId); // Still need getElementById
    if (screenToShow) {
        screenToShow.classList.remove('hidden');
    } else {
        console.error(`UI_Updater: Screen element with ID '${screenId}' not found.`);
        // Fallback: Show login screen? Or display an error?
        if (ui.loginScreen) ui.loginScreen.classList.remove('hidden');
        if (ui.errorMessage) {
            ui.errorMessage.textContent = `Error: Screen '${screenId}' not found.`;
            ui.errorMessage.classList.remove('hidden');
        }
    }
}

/**
 * Displays an error message in the designated error area.
 * @param {string | null} message - The error message text, or null/empty to clear.
 * @param {object} ui - The cache object containing the errorMessage element.
 */
function showError(message, ui) {
    if (!ui.errorMessage) {
        console.error("UI_Updater: Error message element not found in UI cache.");
        return;
    }
    if (!message) {
        clearError(ui); // Call clearError if message is empty/null
        return;
    }
     ui.errorMessage.textContent = message;
     ui.errorMessage.classList.remove('hidden');
     console.log(`UI_Updater: Showing error: ${message}`);
 }

/**
 * Clears the error message display area.
 * @param {object} ui - The cache object containing the errorMessage element.
 */
 function clearError(ui) {
    if (ui.errorMessage) {
         ui.errorMessage.textContent = '';
         ui.errorMessage.classList.add('hidden');
    }
 }

/**
 * Updates the Waiting Room UI elements (Game Code, Player List, Start Button visibility).
 * @param {string | null} gameCode - The current game code.
 * @param {Array} players - Array of player objects { player_id, player_name }.
 * @param {number | null} currentPlayerId - The ID of the current user viewing the screen.
 * @param {boolean} isGameMaster - Whether the current user is the Game Master.
 * @param {object} ui - The cache object containing relevant waiting room elements.
 * @param {function} escapeHtml - The utility function to escape HTML characters.
 */
function updateWaitingRoomUI(gameCode, players, currentPlayerId, isGameMaster, ui, escapeHtml) {
    console.log("UI_Updater: Updating Waiting Room UI");
    // Log state only if the screen might be visible (for easier debugging)
    if (ui.waitingRoom && !ui.waitingRoom.classList.contains('hidden')) {
         console.log(` -> State: gameCode=${gameCode}, playerId=${currentPlayerId}, isGM=${isGameMaster}, players=`, players);
    }

    // Update Game Code display
    if (ui.displayGameCode) {
        ui.displayGameCode.textContent = gameCode || 'N/A';
    } else { console.warn("UI_Updater: Display game code element not found."); }

    // Update Player List
    if (ui.playerList) {
        const playerArray = Array.isArray(players) ? players : [];
        ui.playerList.innerHTML = playerArray.map(p =>
            // Generate list item for each player
            `<li data-player-id="${p.player_id}">
                ${escapeHtml(p.player_name)} ${p.player_id === currentPlayerId ? '<strong>(You)</strong>' : ''}
             </li>`
        ).join('');
    } else { console.warn("UI_Updater: Player list element not found."); }

    // Update Start Button and Waiting Message visibility based on GM status
    if (ui.startGameBtn && ui.waitingRoomMessage) {
         if (isGameMaster) {
             ui.startGameBtn.classList.remove('hidden');
             const playerCount = Array.isArray(players) ? players.length : 0;
             // Disable start button if fewer than 2 players
             ui.startGameBtn.disabled = playerCount < 2;
             ui.waitingRoomMessage.classList.add('hidden');
         } else {
             ui.startGameBtn.classList.add('hidden');
             ui.waitingRoomMessage.classList.remove('hidden');
         }
    } else { console.warn("UI_Updater: Start button or waiting message element not found."); }
}

/**
 * Shows or hides the generic "Waiting for other players..." message area.
 * Also clears the task area when showing the waiting message.
 * @param {boolean} show - Whether to show (true) or hide (false) the message.
 * @param {object} ui - The cache object containing waitingMessage and taskArea elements.
 */
function showWaitingMessage(show = true, ui) {
    if (ui.waitingMessage && ui.taskArea) {
        if (show) {
            console.log("UI_Updater: Showing waiting message.");
            ui.waitingMessage.classList.remove('hidden');
            ui.taskArea.innerHTML = ''; // Clear the specific task UI
        } else {
            // console.log("UI_Updater: Hiding waiting message."); // Optional log
            ui.waitingMessage.classList.add('hidden');
        }
    } else { console.warn("UI_Updater: Waiting message or task area element not found."); }
}

/**
 * Updates the text content of the timer display element.
 * @param {number | null} seconds - Remaining seconds, or null to clear display.
 * @param {object} ui - The cache object containing the timerDisplay element.
 */
function updateTimerDisplay(seconds, ui) {
    if (!ui.timerDisplay) { console.warn("UI_Updater: Timer display element not found."); return; }

    if (seconds === null || typeof seconds !== 'number') {
        ui.timerDisplay.textContent = '';
        return;
    }

    if (seconds < 0) seconds = 0; // Don't show negative time

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    // Format as MM:SS
    ui.timerDisplay.textContent = `Time Left: ${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

/**
 * Clears the timer display text. (Doesn't stop the actual interval timer).
 * @param {object} ui - The cache object containing the timerDisplay element.
 */
function clearTimerDisplay(ui) {
    updateTimerDisplay(null, ui); // Call update with null
}

/**
 * Renders the final reveal screen, displaying all threads step-by-step.
 * @param {Array} threads - Array of thread objects from the server.
 * @param {object} ui - The cache object containing the revealContent element.
 * @param {function} escapeHtml - The utility function to escape HTML characters.
 */
function renderReveal(threads, ui, escapeHtml) {
    console.log("UI_Updater: Rendering reveal data.");
    if (!ui.revealContent) { console.error("UI_Updater: Reveal content element not found."); return; }
    ui.revealContent.innerHTML = ''; // Clear previous content (like loading message or old results)

    if (!Array.isArray(threads) || threads.length === 0) {
        ui.revealContent.innerHTML = '<p class="waiting-message">No game data found to reveal.</p>';
        return;
    }

    // Sort threads alphabetically by original player name for consistent order
    threads.sort((a, b) => a.originalPlayerName.localeCompare(b.originalPlayerName));

    threads.forEach(thread => {
        const threadDiv = document.createElement('div');
        threadDiv.className = 'thread';
        threadDiv.innerHTML = `<h3>Thread started by: ${escapeHtml(thread.originalPlayerName)}</h3>`; // Escape name

        // Ensure thread.steps is an array before iterating
        const stepsArray = Array.isArray(thread.steps) ? thread.steps : [];

        stepsArray.forEach(step => {
            const stepDiv = document.createElement('div');
            stepDiv.className = 'step';
            let contentHtml = '', typeLabel = '';
            const safeContent = step.content || ''; // Use empty string if content is null/undefined

            // Determine content type and format appropriately
            if (step.stepType === 'prompt') {
                typeLabel = 'Prompt'; contentHtml = `<p>"${escapeHtml(safeContent)}"</p>`; // Escape prompt text
            } else if (step.stepType === 'drawing') {
                typeLabel = 'Drawing'; contentHtml = `<img src="${safeContent}" alt="Drawing by ${escapeHtml(step.playerName)}">`; // Image src assumes valid data URL, escape alt text
            } else if (step.stepType === 'guess') {
                typeLabel = 'Guess'; contentHtml = `<p>"${escapeHtml(safeContent)}"</p>`; // Escape guess text
            } else {
                typeLabel = `Unknown Step (${escapeHtml(step.stepType || 'N/A')})`; // Escape type if unknown
                contentHtml = `<p><i>${escapeHtml(safeContent)}</i></p>`; // Escape unknown content
            }
            // Add player name (escaped) and formatted content
            stepDiv.innerHTML = `<p><em>By: ${escapeHtml(step.playerName)}</em></p><p><strong>${typeLabel}:</strong></p>${contentHtml}`;
            threadDiv.appendChild(stepDiv);
        }); // end steps.forEach

        ui.revealContent.appendChild(threadDiv);
    }); // end threads.forEach
}

/**
 * Renders the list of active games on the login screen.
 * @param {Array} games - Array of game objects { game_code, game_id, player_count }.
 * @param {object} ui - The cache object containing activeGamesList element.
 * @param {function} escapeHtml - The utility function (though not strictly needed here).
 */
function renderActiveGames(games, ui, escapeHtml) { // escapeHtml passed but not used currently
    if (!ui.activeGamesList) { console.error("UI_Updater: Active games list element not found."); return; }
    ui.activeGamesList.innerHTML = ''; // Clear previous list
    const gameArray = Array.isArray(games) ? games : [];

    if (gameArray.length === 0) {
        ui.activeGamesList.innerHTML = '<li class="no-games">No waiting games available. Ask admin!</li>';
        return;
    }

    gameArray.forEach(game => {
        const gameItem = document.createElement('li');
        gameItem.setAttribute('data-game-code', game.game_code); // Store code for join button logic

        const codeSpan = document.createElement('span');
        codeSpan.textContent = game.game_code; // No escaping needed for game code typically

        const playerCountSpan = document.createElement('span');
        playerCountSpan.className = 'player-count';
        const count = Number(game.player_count) || 0; // Ensure count is a number
        playerCountSpan.textContent = `(${count} player${count !== 1 ? 's' : ''})`;

        const joinButton = document.createElement('button');
        joinButton.textContent = 'Join';
        joinButton.className = 'join-game-list-btn'; // Class for attaching event listener
        joinButton.setAttribute('data-game-code', game.game_code); // Store code on button too

        // Assemble the list item
        gameItem.appendChild(codeSpan);
        gameItem.appendChild(playerCountSpan);
        gameItem.appendChild(joinButton);
        ui.activeGamesList.appendChild(gameItem);
    });
}

/**
 * Renders the specific task UI (prompt, draw, guess) into the taskArea.
 * @param {string} taskType - 'prompt', 'draw', or 'guess'.
 * @param {object | null} taskData - Data needed for the task (e.g., { content: '...' } for draw/guess).
 * @param {object} ui - The cache object containing taskArea element.
 * @param {function} escapeHtml - The utility function to escape HTML characters.
 */
function renderTaskUI(taskType, taskData, ui, escapeHtml) {
     if (!ui.taskArea) { console.error("UI_Updater: Task area not found for rendering task UI."); return; }
     console.log(`UI_Updater: Rendering UI for task: ${taskType}`);

     let html = '';
     const safeContent = taskData?.content || ''; // Safely access content

     if (taskType === 'prompt') {
         html = `
             <h3>Your Turn: Create a Prompt!</h3>
             <p>Write a short, descriptive phrase (e.g., "A happy dog flying a kite").</p>
             <textarea id="promptInput" placeholder="Enter your prompt here..." rows="3" maxlength="200"></textarea>
             <button id="randomPromptBtn">Get Random Idea</button>
             <button id="submitPromptBtn">Submit Prompt</button>
         `;
     } else if (taskType === 'draw') {
          html = `
             <h3>Your Turn: Draw!</h3>
             <div id="promptDisplay"><strong>Draw this:</strong> ${escapeHtml(safeContent)}</div>
             <div id="drawingControls">
                 <label for="dColor">Color:</label>
                 <input type="color" id="dColor" value="#000000">
                 <label for="dSize">Size:</label>
                 <input type="range" id="dSize" min="1" max="30" value="5">
                 <button id="dClear">Clear</button>
              </div>
              <canvas id="drawingCanvas"></canvas>
              <button id="submitDrawingBtn">Submit Drawing</button>
          `;
     } else if (taskType === 'guess') {
          html = `
             <h3>Your Turn: Guess!</h3>
             <p>Look at the drawing below and describe what you think the original prompt was.</p>
             <div id="drawingDisplay"><img src="${safeContent}" alt="Drawing to guess"></div>
             <textarea id="guessInput" placeholder="Enter your guess here..." rows="3" maxlength="200"></textarea>
             <button id="submitGuessBtn">Submit Guess</button>
          `;
     } else {
          console.error("UI_Updater: Unknown task type to render:", taskType);
          html = `<p class="waiting-message">Error: Received unknown task.</p>`;
          // Optionally show a general error message
          showError("Received an unknown task from the server.", ui);
     }
     // Update the task area content
     ui.taskArea.innerHTML = html;
}


// --- Module Exports ---
// Export all functions intended to be used by client.js
export {
    showScreen,
    showError,
    clearError,
    updateWaitingRoomUI,
    showWaitingMessage,
    updateTimerDisplay,
    clearTimerDisplay,
    renderReveal,
    renderActiveGames,
    renderTaskUI
};