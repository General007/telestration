Okay, based on our refactoring process, here is the file and folder structure we created for the Telestrations game application, assuming the root folder is `C:\TelestrationsGameApp`:

```
C:\TelestrationsGameApp\
│
├── node_modules\           # Folder created by 'npm install' - contains dependencies
│   ├── express\
│   ├── socket.io\
│   ├── mssql\
│   ├── fabric\             # If installed via npm (Option 2 for Fabric.js)
│   └── ... (many other dependency folders)
│
├── public\                 # Folder for ALL client-side files served by Express
│   │
│   ├── css\                # Subfolder for stylesheets
│   │   └── style.css       # Main CSS file
│   │
│   ├── js\                 # Subfolder for client-side JavaScript
│   │   ├── admin.js        # JavaScript specific to the admin page
│   │   ├── client.js       # Main JavaScript orchestrator for the player page (loads as module)
│   │   ├── uiUpdater.js    # Module for updating player UI DOM elements
│   │   ├── canvasManager.js # Module for managing Fabric.js canvas
│   │   ├── gameActions.js  # Module for handling player submits and UI locking
│   │   └── fabric.min.js   # The Fabric.js library (IF using local serving via npm, otherwise not here)
│   │
│   ├── admin.html          # HTML page for game creation and configuration
│   └── index.html          # Main HTML page for players joining/playing
│
├── .gitignore              # (Recommended) Tells Git which files/folders to ignore (e.g., node_modules)
├── db.js                   # Module for all database interactions (connection pool, queries)
├── gameLogic.js            # Module for core game state transitions and logic
├── helpers.js              # Module for utility functions (generate code, get/broadcast games)
├── package-lock.json       # Created by npm, locks dependency versions
├── package.json            # Defines project metadata and dependencies
├── server.js               # Main Node.js server entry point (Express, Socket.IO setup, initialization)
└── socketHandlers.js       # Module containing all Socket.IO event handlers
```

**Summary of Key Files and Purpose:**

*   **`server.js`:** Starts the web server, initializes Socket.IO, defines routes (`/`, `/admin`), calls initialization for socket handlers, handles startup/shutdown.
*   **`socketHandlers.js`:** Contains the main `io.on('connection', ...)` block and all `socket.on(...)` handlers for client events (`create_game`, `join_game`, `submit_*`, etc.). Uses `gameLogic.js` and `helpers.js`.
*   **`gameLogic.js`:** Contains the core rules/flow of the game (`checkPhaseCompletion`, `transitionToNextPhase`, `assignTasksAndNotify`, `triggerReveal`, `startPhaseTimer`). Uses `db.js`.
*   **`helpers.js`:** Contains utility functions like `generateGameCode`, `getWaitingGames`, `broadcastWaitingGames`. Uses `db.js`.
*   **`db.js`:** Handles all communication with the MS SQL Server database (connection pool, executing queries for creating games, adding players, saving steps, deactivating threads, etc.).
*   **`public/` folder:** Contains all static assets served to the browser.
    *   **`index.html`:** The main page players see to enter their name and join games from the list.
    *   **`admin.html`:** The separate page for creating games and setting configurations.
    *   **`css/style.css`:** Styles for both pages.
    *   **`js/client.js`:** The main script for `index.html`, orchestrating UI updates, actions, and canvas based on imports. **Loads as `type="module"`.**
    *   **`js/admin.js`:** Script specifically for `admin.html` to handle config inputs and the create game button.
    *   **`js/uiUpdater.js`:** Module imported by `client.js` for updating the DOM.
    *   **`js/canvasManager.js`:** Module imported by `client.js` for handling the Fabric.js canvas.
    *   **`js/gameActions.js`:** Module imported by `client.js` for handling submissions and UI locking.
    *   **`js/fabric.min.js`:** (Optional) If serving Fabric.js locally instead of using a CDN.
*   **`package.json` / `package-lock.json`:** Manage project dependencies installed via `npm`.
*   **`.gitignore`:** (Recommended) To keep `node_modules` and potentially log files or config secrets out of version control.

This structure provides a good separation of concerns for the application.