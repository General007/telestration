// C:\TelestrationsGameApp\public\js\canvasManager.js

/**
 * This module encapsulates the logic for setting up, interacting with,
 * and retrieving data from the Fabric.js canvas.
 */

// Module-level variable to hold the single Fabric canvas instance for the current task.
// This prevents multiple canvas instances being created accidentally.
let fabricCanvas = null;

/**
 * Initializes or re-initializes the Fabric.js canvas on the designated element.
 * Disposes of any previous canvas instance first.
 * Attaches necessary controls.
 * @param {HTMLElement} taskAreaElement - The parent container element (used for sizing).
 * @returns {fabric.Canvas | null} The initialized Fabric canvas instance, or null on error.
 */
function setupCanvas(taskAreaElement) {
    // Dispose of the old canvas instance if it exists, releasing its resources.
    if (fabricCanvas) {
        console.log("Canvas Manager: Disposing previous canvas instance.");
        try {
            fabricCanvas.dispose();
        } catch(disposeError) {
            console.error("Canvas Manager: Error disposing previous canvas:", disposeError);
        } finally {
            fabricCanvas = null;
        }
    }

    const canvasElement = document.getElementById('drawingCanvas');
    // Ensure the required DOM elements are present before proceeding.
    if (!canvasElement) {
        console.error("Canvas Manager: Canvas element ('drawingCanvas') not found in DOM!");
        return null; // Cannot proceed without canvas element
    }
    if (!taskAreaElement) {
        console.error("Canvas Manager: Task area element not found for sizing canvas!");
        return null; // Cannot size canvas properly
    }

    // --- Calculate Canvas Size ---
    // Base size on parent container width, with min/max constraints.
    const containerWidth = taskAreaElement.offsetWidth > 0 ? taskAreaElement.offsetWidth - 40 : 600; // Account for padding, default 600
    const canvasWidth = Math.max(300, Math.min(containerWidth, 600)); // Min width 300px, Max width 600px
    const canvasHeight = canvasWidth * (2 / 3); // Maintain a 3:2 aspect ratio
    canvasElement.width = canvasWidth;
    canvasElement.height = canvasHeight;
    console.log(`Canvas Manager: Setting canvas size to ${canvasWidth}x${canvasHeight}`);

    // --- Initialize Fabric Canvas ---
    try {
        fabricCanvas = new fabric.Canvas(canvasElement, {
            isDrawingMode: true, // Start in free drawing mode
            backgroundColor: '#ffffff', // Set a white background
            selection: false, // Disable group object selection by default
            stopContextMenu: true, // Prevent default right-click browser menu
            fireRightClick: true, // Allow detection of right-click if needed later
        });
        console.log("Canvas Manager: Fabric canvas initialized successfully.");

        // Setup listeners for the associated drawing controls (color, size, clear)
        setupCanvasControls();

        return fabricCanvas; // Return the new instance

    } catch (error) {
        console.error("Canvas Manager: Error initializing Fabric canvas instance:", error);
        fabricCanvas = null; // Ensure canvas reference is null on error
        // Potentially notify the user via an imported UI function if available
        // showError("Failed to initialize drawing area.");
        return null;
    }
}

/**
 * Attaches event listeners to the drawing control elements (color picker, size slider, clear button).
 * Assumes fabricCanvas instance is already created and available in the module scope.
 * Assumes control elements exist in the DOM when called (usually after renderTaskUI).
 */
function setupCanvasControls() {
    if (!fabricCanvas) {
        console.error("Canvas Manager: setupCanvasControls called but canvas instance is not available.");
        return;
    }

    // Get control elements
    const colorPicker = document.getElementById('dColor');
    const sizeSlider = document.getElementById('dSize');
    const clearButton = document.getElementById('dClear');

    // Check if controls exist
    if (!colorPicker || !sizeSlider || !clearButton) {
        console.error("Canvas Manager: One or more drawing control elements (dColor, dSize, dClear) not found in DOM!");
        // Continue without controls? Or return? Returning might be safer.
        return;
    }

    // Set initial brush state from default control values
    try {
        fabricCanvas.freeDrawingBrush.color = colorPicker.value;
        fabricCanvas.freeDrawingBrush.width = parseInt(sizeSlider.value, 10);
    } catch (brushError) {
         console.error("Canvas Manager: Error setting initial brush properties:", brushError);
    }


    // --- Add Event Listeners ---

    // Update brush size immediately as slider changes
    sizeSlider.addEventListener('input', (e) => {
        if (fabricCanvas) {
            const newSize = parseInt(e.target.value, 10);
            if (!isNaN(newSize)) {
                fabricCanvas.freeDrawingBrush.width = newSize;
            }
        }
    });

    // Update brush color when color picker value is confirmed
    colorPicker.addEventListener('change', (e) => {
        if (fabricCanvas) {
            fabricCanvas.freeDrawingBrush.color = e.target.value;
        }
    });

    // Clear button functionality
    clearButton.addEventListener('click', () => {
        if (fabricCanvas) {
            console.log("Canvas Manager: Clearing canvas.");
            fabricCanvas.clear();
            // Fabric's clear() also removes the background, so reapply it
            fabricCanvas.backgroundColor = '#ffffff';
            fabricCanvas.renderAll(); // Redraw the empty canvas with background
        }
    });

    console.log("Canvas Manager: Drawing controls setup complete.");
}

/**
 * Exports the current canvas content as a PNG Base64 Data URL.
 * @returns {string | null} The Base64 Data URL string, or null if canvas isn't available or export fails.
 */
function getDrawingData() {
    if (fabricCanvas) {
        try {
            // Export the canvas content
            const dataUrl = fabricCanvas.toDataURL({ format: 'png' });
            console.log("Canvas Manager: Drawing data exported."); // Be mindful logging potentially large data URLs
            return dataUrl;
        } catch (e) {
            // Log error and return null if export fails
            console.error("Canvas Manager: Error exporting canvas to Data URL:", e);
            return null;
        }
    }
    // Log error and return null if canvas isn't ready
    console.error("Canvas Manager: getDrawingData called but canvas instance not available.");
    return null;
}

/**
 * Enables or disables the drawing mode and object selectability on the canvas.
 * @param {boolean} enable - True to enable drawing, false to disable.
 */
function setCanvasDrawingMode(enable) {
     if (fabricCanvas) {
         try {
             fabricCanvas.isDrawingMode = enable;
             // Also enable/disable selecting objects on the canvas
             fabricCanvas.selection = enable;
             fabricCanvas.forEachObject(obj => {
                 obj.selectable = enable;
                 // Optionally make objects non-interactive too when disabled
                 // obj.evented = enable;
             });
             fabricCanvas.renderAll(); // Apply changes visually
             console.log(`Canvas Manager: Drawing mode set to ${enable}`);
         } catch (e) {
             console.error(`Canvas Manager: Error setting drawing mode to ${enable}:`, e);
         }
     } else {
          console.warn(`Canvas Manager: Attempted to set drawing mode to ${enable}, but canvas not initialized.`);
     }
}


// --- Module Exports ---
// Export the functions needed by client.js
export {
    setupCanvas,
    getDrawingData,
    setCanvasDrawingMode
    // setupCanvasControls is called internally by setupCanvas, might not need export
};