/**
 * LessonManager.js - Educational AR Lesson Plugin Orchestrator
 *
 * Responsibility:
 * - Dynamically imports, loads, activates, and manages educational lesson plugins.
 * - Enforces the ILesson plugin lifecycle interface: initialize(), activate(), deactivate(), dispose(), getMetadata().
 * - Guarantees single active lesson state and prevents memory leaks / duplicate listeners during switching.
 * - Passes application context (scene, eventBus, objectLoader, anchorManager, trackerManager, debugPanel) to lessons.
 * - Emits lesson lifecycle events via EventBus.
 * - Handles plugin loading errors gracefully.
 *
 * Public API:
 * - initialize(context)
 * - loadLesson(id)
 * - activateLesson(id)
 * - deactivateCurrentLesson()
 * - getCurrentLesson()
 * - getAvailableLessons()
 * - dispose()
 *
 * Events emitted via EventBus:
 * - LESSON_LOADING      { id }
 * - LESSON_LOADED       { id, metadata, lesson }
 * - LESSON_ACTIVATED    { id, metadata }
 * - LESSON_DEACTIVATED  { id }
 * - LESSON_DISPOSED     { id }
 * - LESSON_ERROR        { id, error }
 */
import cbseActivities from './cbseMathsLabActivities.json';

// Vite builds this map at compile time. Using import.meta.glob avoids runtime
// path construction, which is unreliable for production bundles and GitHub Pages.
const LESSON_MODULES = import.meta.glob('./lessons/*/lesson.js');

export class LessonManager {
    /**
     * @param {EventBus|null} [eventBus=null] - The global pub/sub event bus instance.
     * @param {Object} [context={}] - Optional initial engine context.
     */
    constructor(eventBus = null, context = {}) {
        this._eventBus = eventBus;
        this._context = { ...context };
        if (eventBus && !this._context.eventBus) {
            this._context.eventBus = eventBus;
        }

        /** @type {Object|null} Currently active lesson record `{ id, instance, metadata, active }` */
        this._currentLesson = null;

        /** @type {Map<string, Object>} Loaded lesson records by ID */
        this._loadedLessons = new Map();

        /** @type {Map<string, Object>} Available lesson metadata by ID */
        this._availableLessons = new Map();

        this._initialized = false;

        // Register default platform lesson descriptors
        this._registerDefaultLessons();
    }

    /**
     * Initializes the LessonManager with the global application context.
     *
     * @param {Object} context - Application context provided to lesson plugins.
     * @param {THREE.Scene} context.scene - Main 3D scene instance.
     * @param {EventBus} context.eventBus - Global event bus.
     * @param {ObjectLoader} context.objectLoader - Asset loader and cache manager.
     * @param {AnchorManager} context.anchorManager - AR anchor mapping manager.
     * @param {TrackerManager} context.trackerManager - Tracked object lifecycle manager.
     * @param {DebugPanel} [context.debugPanel] - Optional debug panel instance.
     * @returns {LessonManager} returns this instance for chaining.
     */
    initialize(context = {}) {
        this._context = { ...this._context, ...context };
        if (this._context.eventBus) {
            this._eventBus = this._context.eventBus;
        }
        this._initialized = true;
        console.log('LessonManager: Initialized with engine context.');
        return this;
    }

    /**
     * Discovers and returns metadata for all available lesson plugins.
     *
     * @returns {Array<Object>} List of available lesson metadata objects.
     */
    getAvailableLessons() {
        return Array.from(this._availableLessons.values());
    }

    /**
     * Returns the currently active lesson record, or null if no lesson is active.
     *
     * @returns {Object|null} Current active lesson object or null.
     */
    getCurrentLesson() {
        return this._currentLesson;
    }

    /**
     * Dynamically imports and loads a lesson plugin by ID.
     * Validates and initializes the plugin with the engine context.
     *
     * @param {string} id - Unique identifier of the lesson plugin (e.g., 'cube', 'pyramid', 'pizza').
     * @returns {Promise<Object>} Resolves with the loaded lesson record.
     */
    async loadLesson(id) {
        if (!id || typeof id !== 'string') {
            const err = new Error('LessonManager.loadLesson: id must be a valid non-empty string.');
            this._emit('LESSON_ERROR', { id, error: err });
            throw err;
        }

        // Return if already loaded
        if (this._loadedLessons.has(id)) {
            return this._loadedLessons.get(id);
        }

        if (!this._availableLessons.has(id)) {
            const error = new Error(`LessonManager: Unknown CBSE lesson id "${id}".`);
            this._emit('LESSON_ERROR', { id, error });
            throw error;
        }

        this._emit('LESSON_LOADING', { id });
        console.log(`LessonManager: Loading packaged CBSE lesson "${id}"...`);

        let module = null;
        let jsonMetadata = null;

        // Vite resolves these imports at build time. This is deterministic in
        // dev, production and static GitHub Pages deployments.
        const moduleKey = `./lessons/${id}/lesson.js`;
        const loader = LESSON_MODULES[moduleKey];
        if (!loader) {
            const error = new Error(`LessonManager: No packaged lesson module found for "${id}".`);
            this._emit('LESSON_ERROR', { id, error });
            throw error;
        }

        try {
            module = await loader();
        } catch (err) {
            const error = new Error(`LessonManager: Failed to load lesson "${id}": ${err?.message || err}`);
            this._emit('LESSON_ERROR', { id, error });
            throw error;
        }

        // Metadata is already packaged in cbseMathsLabActivities.json. An
        // optional lesson.json can still override/add fields where present.
        try {
            const metaKey = `./lessons/${id}/lesson.json`;
            const jsonLoader = import.meta.glob('./lessons/*/lesson.json', { eager: true });
            const json = jsonLoader[metaKey];
            jsonMetadata = json?.default || json || null;
        } catch {
            jsonMetadata = null;
        }

        // 3. Instantiate and normalize lesson interface
        let instance = null;
        if (typeof module.Lesson === 'function') {
            instance = new module.Lesson();
        } else if (typeof module.default === 'function') {
            instance = new module.default();
        } else if (module.default && typeof module.default === 'object') {
            instance = module.default;
        } else if (typeof module.createLesson === 'function') {
            instance = module.createLesson();
        } else {
            instance = module;
        }

        const normalized = this._normalizeLessonInstance(instance, id, jsonMetadata);

        // 4. Initialize plugin with engine context
        try {
            await normalized.initialize(this._context);
        } catch (err) {
            const error = new Error(`LessonManager: Error during initialize() of lesson "${id}": ${err?.message || err}`);
            this._emit('LESSON_ERROR', { id, error });
            throw error;
        }

        const metadata = normalized.getMetadata();
        const lessonRecord = {
            id,
            instance: normalized,
            rawModule: module,
            metadata,
            active: false,
        };

        this._loadedLessons.set(id, lessonRecord);
        this._availableLessons.set(id, metadata);

        this._emit('LESSON_LOADED', { id, metadata, lesson: lessonRecord });
        console.log(`LessonManager: Successfully loaded lesson plugin "${id}".`);
        return lessonRecord;
    }

    /**
     * Activates a lesson by ID.
     * Deactivates the currently active lesson first if one exists.
     * Loads the target lesson dynamically if not already loaded.
     *
     * @param {string} id - The lesson ID to activate.
     * @returns {Promise<Object>} Resolves with the activated lesson record.
     */
    async activateLesson(id) {
        if (!id) {
            throw new Error('LessonManager.activateLesson: id is required.');
        }

        // If target lesson is already active, return immediately
        if (this._currentLesson && this._currentLesson.id === id && this._currentLesson.active) {
            return this._currentLesson;
        }

        // Deactivate previous active lesson
        await this.deactivateCurrentLesson();

        // Load if not loaded
        let lessonRecord = this._loadedLessons.get(id);
        if (!lessonRecord) {
            lessonRecord = await this.loadLesson(id);
        }

        try {
            console.log(`LessonManager: Activating lesson "${id}"...`);
            await lessonRecord.instance.activate();
            lessonRecord.active = true;
            this._currentLesson = lessonRecord;

            this._emit('LESSON_ACTIVATED', { id, metadata: lessonRecord.metadata });
            console.log(`LessonManager: Lesson "${id}" activated.`);
            return lessonRecord;

        } catch (err) {
            lessonRecord.active = false;
            const error = new Error(`LessonManager: Failed to activate lesson "${id}": ${err?.message || err}`);
            this._emit('LESSON_ERROR', { id, error });
            throw error;
        }
    }

    /**
     * Deactivates the currently active lesson cleanly.
     *
     * @returns {Promise<Object|null>} Resolves with deactivated lesson record or null.
     */
    async deactivateCurrentLesson() {
        if (!this._currentLesson) return null;

        const lessonRecord = this._currentLesson;
        if (lessonRecord.active) {
            try {
                console.log(`LessonManager: Deactivating lesson "${lessonRecord.id}"...`);
                await lessonRecord.instance.deactivate();
            } catch (err) {
                console.error(`LessonManager: Error during deactivate() for lesson "${lessonRecord.id}":`, err);
            } finally {
                lessonRecord.active = false;
                this._emit('LESSON_DEACTIVATED', { id: lessonRecord.id });
                console.log(`LessonManager: Lesson "${lessonRecord.id}" deactivated.`);
            }
        }

        this._currentLesson = null;
        return lessonRecord;
    }

    /**
     * Unloads and disposes a specific lesson plugin.
     *
     * @param {string} id - Lesson ID to dispose.
     * @returns {Promise<boolean>} True if found and disposed.
     */
    async unloadLesson(id) {
        const lessonRecord = this._loadedLessons.get(id);
        if (!lessonRecord) return false;

        if (this._currentLesson && this._currentLesson.id === id) {
            await this.deactivateCurrentLesson();
        }

        try {
            await lessonRecord.instance.dispose();
        } catch (err) {
            console.error(`LessonManager: Error during dispose() of lesson "${id}":`, err);
        }

        this._loadedLessons.delete(id);
        this._emit('LESSON_DISPOSED', { id });
        console.log(`LessonManager: Unloaded and disposed lesson "${id}".`);
        return true;
    }

    /**
     * Releases all active lessons, unsubscribes events, and resets state.
     *
     * @returns {Promise<void>}
     */
    async dispose() {
        await this.deactivateCurrentLesson();

        const loadedIds = Array.from(this._loadedLessons.keys());
        for (const id of loadedIds) {
            await this.unloadLesson(id);
        }

        this._currentLesson = null;
        this._loadedLessons.clear();
        this._availableLessons.clear();
        this._context = null;
        this._eventBus = null;
        this._initialized = false;
        console.log('LessonManager: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  Private Helpers
    // ------------------------------------------------------------------ //

    /**
     * Pre-registers default platform educational lesson descriptors.
     * @private
     */
    _registerDefaultLessons() {
        // The CBSE activity JSON is the single source of truth for the browser.
        // Only these 26 lessons are exposed; legacy/demo lessons remain in the
        // repository for reference but cannot leak into the production catalog.
        for (const activity of cbseActivities) {
            this._availableLessons.set(activity.id, {
                ...activity,
                description: activity.description || this._defaultDescription(activity),
                difficulty: activity.difficulty || 'Beginner',
                markerTags: [1, 2, 3, 4, 5],
                physicalAR: true,
            });
        }
    }

    _defaultDescription(activity) {
        return `Interactive ${activity.title} lesson using physical AprilTag markers and live AR feedback.`;
    }

    /**
     * Helper to emit lifecycle events via EventBus.
     *
     * @param {string} eventName
     * @param {Object} payload
     * @private
     */
    _emit(eventName, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(eventName, payload);
        }
    }

    /**
     * Wraps and normalizes any lesson plugin instance into a strict ILesson interface contract.
     *
     * @param {Object} instance - Raw imported module or instance.
     * @param {string} id - Lesson ID.
     * @param {Object|null} jsonMeta - Optional metadata from lesson.json.
     * @returns {Object} Normalized ILesson instance.
     * @private
     */
    _normalizeLessonInstance(instance, id, jsonMeta) {
        const getMeta = typeof instance.getMetadata === 'function'
            ? () => instance.getMetadata()
            : () => (jsonMeta || this._availableLessons.get(id) || { id, title: `Lesson ${id}` });

        const initFn = typeof instance.initialize === 'function'
            ? (ctx) => instance.initialize(ctx)
            : typeof instance.init === 'function'
                ? (ctx) => instance.init(ctx)
                : async () => {};

        const actFn = typeof instance.activate === 'function'
            ? () => instance.activate()
            : () => {};

        const deactFn = typeof instance.deactivate === 'function'
            ? () => instance.deactivate()
            : typeof instance.cleanup === 'function'
                ? () => instance.cleanup()
                : () => {};

        const dispFn = typeof instance.dispose === 'function'
            ? () => instance.dispose()
            : typeof instance.cleanup === 'function'
                ? () => instance.cleanup()
                : () => {};

        return {
            id,
            rawInstance: instance,
            getMetadata: getMeta,
            initialize: initFn,
            activate: actFn,
            deactivate: deactFn,
            dispose: dispFn,
        };
    }
}

