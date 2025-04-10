Okay, here is a comprehensive project description covering its purpose, design decisions, implementation status, database structure, and planned features, based on our entire conversation up to the point before discussing IDEs or hosting platforms.

**Project Overview**

*   **Project Name:** (Informal) Team Drawing & Guessing Game (Similar to Telestrations/Eat Poop You Cat)
*   **Purpose:** To create a fun, web-based, real-time multiplayer game for internal team-building or social events. The game involves players iteratively describing prompts, drawing based on descriptions, and guessing prompts based on drawings, leading to humorous misinterpretations revealed at the end.
*   **Target Users:** Internal teams at a workplace. Assumes a trusted environment (limited security focus initially).
*   **Core Concept:** A digital version of the "telephone game" played with alternating text prompts and drawings.

**Gameplay Flow (As Implemented/Designed)**

1.  **Setup:**
    *   An **Admin** navigates to a dedicated `/admin` page.
    *   The Admin configures game settings:
        *   Number of drawing/guessing rounds (1-5, default 2).
        *   Time limit for submitting prompts (default 60s).
        *   Time limit for drawing (default 300s).
        *   Time limit for guessing (default 120s).
        *   Specifies a **Game Code** (defaults to 'DEBUG' in debug mode, otherwise can be specified or left blank for random generation).
    *   The Admin enters their name (defaults to 'Admin') and clicks "Create New Game".
    *   The server creates the game record with the specified configuration and adds the Admin as the first player and the designated **Game Master (GM)**.
    *   The Admin's browser is redirected to the main player page (`/`) and automatically joins the waiting room for the created game.

2.  **Player Joining:**
    *   Other players navigate to the main page (`/`).
    *   They see a list of currently "waiting" games, displaying the Game Code and current player count.
    *   They enter their desired player name.
    *   They click the "Join" button next to the desired game code in the list.
    *   The server adds the player to the game if the name isn't taken and the game is still 'waiting'.
    *   All players in the waiting room (including the new player and the GM) see the updated player list.

3.  **Starting the Game:**
    *   Once at least two players (including the GM) have joined, the "Start Game" button becomes enabled *only* for the GM in the waiting room.
    *   The GM clicks "Start Game".
    *   The server updates the game status, broadcasts `game_started`, creates internal "threads" (one originating from each player), and sends the first task.

4.  **Prompt Phase (Round 0, Step 0):**
    *   All players receive the `task_prompt` event.
    *   Their UI shows a text area to enter a short descriptive prompt (e.g., "A cat riding a unicorn"). A random prompt generator button is available.
    *   A timer starts (using the configured prompt time limit).
    *   Players type and submit their prompts.

5.  **Initial Drawing Phase (Round 0, Step 1 - Player Draws Own Prompt):**
    *   Once all prompts are submitted (or the timer expires, triggering dropout handling), the server transitions to the `initial_drawing` status.
    *   The server assigns each player *their own prompt* back via the `task_draw` event.
    *   The UI shows the prompt text and a drawing canvas (using Fabric.js).
    *   A timer starts (using the configured drawing time limit).
    *   Players draw their prompt and submit the drawing.
    *   **Activity Detection:** (Planned, not fully implemented on client yet) The client detects if the user interacts with the canvas. If the timer expires *and* activity was detected, the client auto-submits the current drawing. If no activity, the client does nothing.

6.  **Guessing Phase (Round 1, Step 2):**
    *   Once all initial drawings are submitted (or skipped via timeout), the server transitions to the `guessing` status (Round 1).
    *   The server **shuffles** the drawings (Step 1 results from active threads).
    *   It assigns each drawing to a *different player* than the one who drew it (and preferably different from the originator), sending a `task_guess` event containing the drawing image data.
    *   The UI shows the received drawing and a text area for guessing the original prompt.
    *   A timer starts (using the configured guessing time limit).
    *   Players type and submit their guesses.
    *   **Activity Detection:** (Planned) Client detects typing. If timer ends and activity detected, auto-submits guess. If no activity, client does nothing.

7.  **Subsequent Drawing Phase (Round 2, Step 3):**
    *   Once all guesses are submitted (or skipped), the server transitions to `drawing` status (Round 2).
    *   The server shuffles the guesses (Step 2 results from active threads).
    *   It assigns each guess (text) to a *different player* than the one who guessed it (and preferably different from originator), sending `task_draw` with the guess text as the content.
    *   The UI shows the guess text and the drawing canvas.
    *   Drawing timer starts. Players draw and submit. Activity detection applies.

8.  **Subsequent Guessing Phase (Round 2, Step 4):**
    *   Once drawings submitted/skipped, server transitions to `guessing` (Round 2).
    *   Shuffles drawings (Step 3 results), assigns to different players, sends `task_guess`.
    *   Guessing timer starts. Players guess and submit. Activity detection applies.

9.  **Looping:** Steps 7 & 8 repeat for the configured `num_rounds`.

10. **Reveal Phase:**
    *   After the final guess phase completes (or times out), the server transitions to `revealing`.
    *   Server queries the database for all steps belonging to **active** threads (`Threads.is_active = 1`).
    *   Server sends the complete data for these active threads to all clients via `reveal_data`.
    *   **Current Reveal UI:** Displays all completed threads sequentially, showing each prompt, drawing, and guess with the player name who performed the step. (Planned Enhancement: Step-by-step reveal per user).

11. **Dropout/Timeout Handling (As Designed):**
    *   If a player fails to submit a prompt, draw, or guess before the main timer expires *and* the client detects no activity (typing/drawing), the client does nothing.
    *   A secondary server check (`checkPhaseCompletion(force=true)`) runs after the timer expires.
    *   This check identifies which players (who were assigned a task for that phase) did not submit.
    *   The server marks the **thread** associated with the non-submitting player as inactive (`Threads.is_active = 0`).
    *   Subsequent assignment phases (`assignTasksAndNotify`) automatically ignore inactive threads when fetching previous steps.
    *   The final reveal only includes data from threads that remained active (`is_active = 1`).

**Key Design Decisions Made:**

*   **Technology Stack:** Node.js, Express, Socket.IO, MS SQL Server (initially), HTML/CSS/JS, Fabric.js. (Decision pending: Migrate DB to PostgreSQL for easier free hosting).
*   **Real-time Communication:** WebSockets (via Socket.IO) for instant updates and task assignments.
*   **Architecture:**
    *   Separated frontend (browser) and backend (Node.js server).
    *   Refactored backend into modular files (`server.js`, `socketHandlers.js`, `gameLogic.js`, `helpers.js`, `db.js`).
    *   Refactored frontend into modular files (`client.js`, `uiUpdater.js`, `canvasManager.js`, `gameActions.js`).
*   **Game Creation:** Moved to a dedicated `/admin` page, allowing configuration of rounds/timers. The admin user who creates the game becomes the Game Master.
*   **Player Join:** Players join via a list of waiting games displayed on the main page.
*   **Initial Flow:** Player writes prompt (Step 0), then immediately draws their *own* prompt (Step 1). Subsequent steps are shuffled.
*   **Dropout Handling:** Use activity detection on the client. Auto-submit if active when timer ends. If inactive, the server detects the missing submission upon final phase check and deactivates the corresponding thread (it does *not* continue with placeholders or repeated content).
*   **Database Storage:** Use SQL database to persist game state, player info, threads, and step content (including image BLOBs/BYTEA).
*   **Security:** Currently minimal (trusted internal environment). Parameterized queries used in `db.js` prevent SQL Injection. `escapeHtml` used on client-side prevents basic XSS from user text input. No HTTPS implemented yet.
*   **Debugging:** Added `DEBUG_MODE` for easier testing with default values/codes. Server clears 'DEBUG' game on startup. Left essential logging in place.

**Database Structure (`TelestrationsGame` - Adapted for PostgreSQL)**

*   **`RandomPrompts`**
    *   `prompt_id` (SERIAL PRIMARY KEY)
    *   `prompt_text` (VARCHAR(255) NOT NULL UNIQUE) - Stores predefined prompt ideas.
*   **`Games`**
    *   `game_id` (SERIAL PRIMARY KEY)
    *   `game_code` (VARCHAR(10) UNIQUE NOT NULL) - Short code for joining.
    *   `status` (VARCHAR(20) NOT NULL DEFAULT 'waiting') - Current state (waiting, prompting, initial_drawing, guessing, drawing, revealing, finished).
    *   `current_round` (INT DEFAULT 0) - Tracks the current Draw/Guess cycle (0 for prompt/initial draw, 1 for first guess/draw2, etc.).
    *   `current_step_type` (VARCHAR(10) DEFAULT NULL) - Expected step type ('prompt', 'drawing', 'guess').
    *   `num_rounds` (INT NOT NULL DEFAULT 2) - Configurable number of Draw/Guess cycles.
    *   `prompt_time_limit_sec` (INT NOT NULL DEFAULT 60) - Configurable time.
    *   `draw_time_limit_sec` (INT NOT NULL DEFAULT 300) - Configurable time.
    *   `guess_time_limit_sec` (INT NOT NULL DEFAULT 120) - Configurable time.
    *   `game_master_player_id` (INT NULL REFERENCES Players(player_id) ON DELETE SET NULL) - ID of the player who created/started the game.
    *   `created_at` (TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP) - When the game was created.
*   **`Players`**
    *   `player_id` (SERIAL PRIMARY KEY)
    *   `game_id` (INT NOT NULL REFERENCES Games(game_id) ON DELETE CASCADE) - Which game the player belongs to.
    *   `player_name` (VARCHAR(50) NOT NULL) - Player's chosen name (Unique within a game checked via code/potential constraint).
    *   `socket_id` (VARCHAR(100) UNIQUE NULL) - Current Socket.IO connection ID (NULL if disconnected). *Unique constraint removed*.
    *   `is_active` (BOOLEAN DEFAULT TRUE) - Tracks if player is currently connected/participating.
    *   `joined_at` (TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
*   **`Threads`**
    *   `thread_id` (SERIAL PRIMARY KEY)
    *   `game_id` (INT NOT NULL REFERENCES Games(game_id) ON DELETE CASCADE)
    *   `original_player_id` (INT NOT NULL REFERENCES Players(player_id)) - Who initiated this prompt/drawing chain.
    *   `is_active` (BOOLEAN DEFAULT TRUE) - Set to FALSE if a step is missed/timed out in this thread.
*   **`Steps`**
    *   `step_id` (SERIAL PRIMARY KEY)
    *   `thread_id` (INT NOT NULL REFERENCES Threads(thread_id) ON DELETE CASCADE)
    *   `player_id` (INT NOT NULL REFERENCES Players(player_id)) - Who performed this step.
    *   `step_number` (INT NOT NULL) - Sequence within thread (0=prompt, 1=initial_draw, 2=guess1, 3=draw2...).
    *   `step_type` (VARCHAR(10) NOT NULL CHECK (...)) - 'prompt', 'drawing', 'guess'. *(Placeholder types removed for now).*
    *   `text_content` (TEXT NULL) - Stores prompt/guess text.
    *   `image_content` (BYTEA NULL) - Stores drawing image data (binary).
    *   `submitted_at` (TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
    *   *(CK_StepContent constraint enforces only text OR image is non-null based on step_type).*

**Planned Next Steps / Feature List:**

1.  **Implement Client-Side Activity Detection:** Add listeners to canvas/textarea and the `activityDetected` flag logic within the `times_up` handler in `client.js`.
2.  **Controlled Reveal:** Implement step-by-step reveal, GM thread selection, "Show All" link.
3.  **Display Waiting Players:** Show list of players yet to submit during phases.
4.  **Game Master Kick/Remove Player:** Add GM ability to remove players and handle the thread deactivation.
5.  **Pre-Phase Countdown:** Implement 3-2-1 countdown UI.
6.  **Improved Rejoin:** Send current task data to rejoining players.
7.  **UI/UX Polish.**
8.  **(Future/Optional):** Profiles/History, AD Auth, HTTPS, Drawing Tool Enhancements, Save/Share Results.
9.  **(Future/Optional):** Migrate database from MS SQL (if currently used) to PostgreSQL for GCP free tier hosting.

This summary should provide a good foundation for understanding the project's current state and future direction.