// C:\TelestrationsGameApp\public\js\admin.js
document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Establish WebSocket connection

    // --- UI Elements ---
    const numRoundsSlider = document.getElementById('numRounds');
    const numRoundsValue = document.getElementById('numRoundsValue');
    const promptTimeInput = document.getElementById('promptTime');
    const drawTimeInput = document.getElementById('drawTime');
    const guessTimeInput = document.getElementById('guessTime');
    const adminNameInput = document.getElementById('adminName');
    const createButton = document.getElementById('adminCreateGameBtn');
    const statusDisplay = document.getElementById('adminStatus');

	// Add inside DOMContentLoaded in admin.js
	const DEBUG_MODE = true; // Or false depending on your setting
	const DEBUG_GAME_CODE = 'DEBUG'; // Consistent code name

	const ui = {
		// ... other elements
		adminGameCodeInput: document.getElementById('adminGameCode'), // *** ADD ***
		adminNameInput: document.getElementById('adminName'),
		createButton: document.getElementById('adminCreateGameBtn'),
		statusDisplay: document.getElementById('adminStatus'),
	};

    // --- Initial Setup & Event Listeners ---

	// Pre-fill if in debug mode
	if (DEBUG_MODE && ui.adminGameCodeInput) {
		console.log("ADMIN DEBUG MODE: Setting default game code input.");
		ui.adminGameCodeInput.value = DEBUG_GAME_CODE;
	}

    // Update round display when slider changes
    if (numRoundsSlider && numRoundsValue) {
        numRoundsSlider.addEventListener('input', () => {
            numRoundsValue.textContent = numRoundsSlider.value;
        });
        // Initial sync
        numRoundsValue.textContent = numRoundsSlider.value;
    } else {
        console.error("Round slider elements not found.");
    }

	if (ui.createButton) {
		ui.createButton.addEventListener('click', () => {
			statusDisplay.textContent = '';
			statusDisplay.className = '';
			ui.createButton.disabled = true;

			const numRounds = ui.numRoundsSlider ? parseInt(ui.numRoundsSlider.value, 10) : 2;
			const promptTime = ui.promptTimeInput ? parseInt(ui.promptTimeInput.value, 10) : 60;
			const drawTime = ui.drawTimeInput ? parseInt(ui.drawTimeInput.value, 10) : 300;
			const guessTime = ui.guessTimeInput ? parseInt(ui.guessTimeInput.value, 10) : 120;
			const playerName = ui.adminNameInput ? ui.adminNameInput.value.trim() : 'Admin';
			// *** Read Game Code Input ***
			let gameCode = ui.adminGameCodeInput ? ui.adminGameCodeInput.value.trim().toUpperCase() : null;

			// Use DEBUG code if in debug mode and input is empty or DEBUG
			if (DEBUG_MODE && (!gameCode || gameCode === DEBUG_GAME_CODE)) {
				gameCode = DEBUG_GAME_CODE;
			} else if (!gameCode && !DEBUG_MODE) {
				gameCode = null; // Let server generate random code
			}
			// Optional: Add validation for game code characters if desired

			if (!playerName) { showAdminStatus('Admin name is required.', true); ui.createButton.disabled = false; return; }
			if (isNaN(numRounds) || isNaN(promptTime) || isNaN(drawTime) || isNaN(guessTime)) { showAdminStatus('Invalid config value detected.', true); ui.createButton.disabled = false; return; }

			const payload = {
				playerName,
				gameCode: gameCode, // Send null for random, or specific code
				numRounds,
				promptTime,
				drawTime,
				guessTime
			};

			console.log('Sending create_game event with payload:', payload);
			socket.emit('create_game', payload);
		});
	} else { console.error("Create button not found."); }

    // --- Socket Event Handlers ---
    socket.on('connect', () => {
        console.log('Admin connected to server:', socket.id);
        showAdminStatus('Connected to server.', false);
        if(createButton) createButton.disabled = false; // Enable button on connect
    });

    socket.on('disconnect', () => {
        console.log('Admin disconnected from server.');
        showAdminStatus('Disconnected from server.', true);
        if(createButton) createButton.disabled = true; // Disable button on disconnect
    });

	// REPLACEMENT for game_created handler in admin.js (Redirects with info)
	socket.on('game_created', (data) => {
		console.log('Game Created Successfully by Admin:', data);
		showAdminStatus(`Game '${data.gameCode}' created! Joining waiting room...`, false);

		// Store game info temporarily to pass to the main page after redirect
		// Use sessionStorage which persists only for the browser tab session
		try {
			 sessionStorage.setItem('autoJoinGame', JSON.stringify({
				 gameCode: data.gameCode,
				 gameId: data.gameId,
				 playerId: data.playerId,
				 playerName: data.playerName,
				 isGameMaster: true,
				 players: data.players // Include initial player list (just the GM)
			 }));
		} catch (e) {
			console.error("Session storage error:", e);
			showAdminStatus("Game created, but failed to setup auto-join. Please join manually.", true);
			 // Re-enable button if redirect fails setup
			 if(ui.createButton) ui.createButton.disabled = false;
			 return; // Don't redirect if storage failed
		}


    // Redirect to the main player page
    setTimeout(() => {
        window.location.href = '/'; // Redirect to '/'
    }, 1500); // Short delay
});

    socket.on('error_message', (message) => {
        console.error('Server Error:', message);
        showAdminStatus(`Error: ${message}`, true);
        if(createButton) createButton.disabled = false; // Re-enable button on error
    });

    // --- Helper Functions ---
    function showAdminStatus(message, isError = false) {
        if (statusDisplay) {
            statusDisplay.textContent = message;
            statusDisplay.className = isError ? 'error' : 'success';
        }
    }

}); // End DOMContentLoaded