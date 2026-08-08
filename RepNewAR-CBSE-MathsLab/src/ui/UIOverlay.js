/**
 * UIOverlay.js - AR Instructional Overlay
 * 
 * Responsibility:
 * - Manages HTML/CSS overlays for instructional text and AR indicators.
 * - Listens for APP_STATE_CHANGED events to update the UI.
 */

export class UIOverlay {
    /**
     * @param {EventBus} eventBus - The global event bus instance.
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.container = document.getElementById('ui-container');
        this.listenForEvents();
    }

    /**
     * Updates the overlay content.
     * @param {string} htmlContent - The HTML string to display.
     */
    setContent(htmlContent) {
        this.container.innerHTML = htmlContent;
    }

    /**
     * Listens for state changes to update the UI.
     */
    listenForEvents() {
        this.eventBus.on('APP_STATE_CHANGED', (data) => {
            // TODO: Render different UI based on app state (e.g., loading spinner, active instructions)
        });
    }
}
