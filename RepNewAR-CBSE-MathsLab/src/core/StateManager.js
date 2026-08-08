/**
 * StateManager.js - Global Application State
 * 
 * Responsibility:
 * - Manages the high-level state of the application (e.g., 'loading', 'active', 'error').
 * - Notifies the UI layer when state changes occur.
 */

export class StateManager {
    /**
     * @param {EventBus} eventBus - The global event bus instance.
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.currentState = 'idle'; // Possible states: idle, loading, active, error
    }

    /**
     * Updates the application state and emits an event.
     * @param {string} newState - The new state string.
     * @param {Object} [payload] - Optional context data.
     */
    setState(newState, payload = {}) {
        const oldState = this.currentState;
        this.currentState = newState;
        this.eventBus.emit('APP_STATE_CHANGED', { oldState, newState, payload });
    }

    /**
     * Gets the current state.
     * @returns {string}
     */
    getState() {
        return this.currentState;
    }
}
