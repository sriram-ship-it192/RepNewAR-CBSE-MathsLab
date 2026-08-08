/**
 * ILesson.js - Interface Definition for Lesson Plugins
 * 
 * Responsibility:
 * - Defines the strict contract that all lesson plugins must implement.
 * - Ensures the core engine never needs modification when adding new lessons.
 * 
 * Interface:
 * - init(context: Object): Promise<void>
 * - cleanup(): void
 */

/**
 * @typedef {Object} LessonContext
 * @property {EventBus} eventBus - The global event bus for communication.
 * @property {SceneManager} sceneManager - The Three.js scene manager.
 * @property {AnchorManager} anchorManager - The physical-to-virtual anchor mapper.
 * @property {ObjectLoader} objectLoader - The 3D model loader and cache.
 * @property {FormulaEngine} formulaEngine - The mathematical calculation engine.
 * @property {AnimationEngine} animationEngine - The visual tweening engine.
 */

/**
 * Initializes the lesson plugin.
 * @param {LessonContext} context - The application context provided by the engine.
 * @returns {Promise<void>} Resolves when the lesson is fully initialized and ready.
 */
export async function init(context) {
    throw new Error("Method 'init()' must be implemented by the lesson plugin.");
}

/**
 * Cleans up the lesson plugin resources.
 * Should remove all added 3D models, unregister anchors, and remove event listeners.
 * @returns {void}
 */
export function cleanup() {
    throw new Error("Method 'cleanup()' must be implemented by the lesson plugin.");
}
