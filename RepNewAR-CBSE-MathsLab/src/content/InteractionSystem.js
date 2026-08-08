import * as THREE from 'three';

/**
 * InteractionSystem.js - Event-Driven Orchestration & Physical/Pointer Interaction Handler
 *
 * Responsibility:
 * - Serves as the central orchestration layer between TrackerManager, AnchorManager,
 *   LessonManager, AnimationEngine, and FormulaEngine using ONLY EventBus communication.
 * - Manages physical marker interactions, raycasting (pointer/mouse picking), touch inputs,
 *   hover state tracking, selection state tracking, and gesture extension points.
 * - NEVER manipulates Three.js objects or geometries directly.
 * - NEVER contains lesson-specific or geometry-specific logic (NO cube/pyramid/pizza logic).
 * - NEVER owns or creates a separate render loop — ties strictly to the existing RENDER_FRAME event.
 * - Fully future-ready for WebXR controllers, gestures, raycasting, and multi-touch.
 * - Guarantees zero memory leaks, no duplicate listeners, and clean teardown on dispose().
 *
 * Public API:
 * - initialize(context)
 * - activate()
 * - deactivate()
 * - enable()
 * - disable()
 * - registerInteraction(type, callback)
 * - unregisterInteraction(type)
 * - dispose()
 *
 * Events Listened To via EventBus:
 * - OBJECT_ADDED, OBJECT_UPDATED, OBJECT_REMOVED
 * - ANCHOR_CREATED, ANCHOR_UPDATED, ANCHOR_REMOVED
 * - LESSON_ACTIVATED, LESSON_DEACTIVATED
 * - RENDER_FRAME
 *
 * Events Emitted via EventBus:
 * - OBJECT_SELECTED       { tagId, anchor, object }
 * - OBJECT_HOVER          { tagId, anchor, object, point, isHovered }
 * - OBJECT_CLICKED        { tagId, anchor, object, point }
 * - LESSON_INTERACTION    { type, tagId, lessonId, payload }
 * - INTERACTION_ENABLED   { timestamp }
 * - INTERACTION_DISABLED  { timestamp }
 */
export class InteractionSystem {
    /**
     * @param {EventBus|null} [eventBus=null] - The global pub/sub event bus instance.
     * @param {Object} [context={}] - Engine context reference.
     */
    constructor(eventBus = null, context = {}) {
        this._eventBus = eventBus;
        this._context = { ...context };
        if (eventBus && !this._context.eventBus) {
            this._context.eventBus = eventBus;
        }

        this._initialized = false;
        this._enabled = false;
        this._active = false;

        // Registries & State Tracking
        this._activeAnchors = new Map(); // tagId -> { anchor, parentId }
        this._activeObjects = new Map(); // tagId -> trackedObject
        this._activeLessonId = null;

        this._customHandlers = new Map(); // type -> callback
        this._listeners = []; // EventBus listener tracking array

        // Pointer / Raycasting State
        this._raycaster = null;
        this._pointerVector = new THREE.Vector2(-999, -999);
        this._hoveredTarget = null; // { tagId, anchor, object, point }
        this._selectedTarget = null; // { tagId, anchor, object }
        this._domElement = null;

        // Bound DOM Event Handlers for Clean Teardown
        this._onPointerMoveBound = this._onPointerMove.bind(this);
        this._onPointerDownBound = this._onPointerDown.bind(this);
        this._onPointerUpBound = this._onPointerUp.bind(this);
        this._onPointerLeaveBound = this._onPointerLeave.bind(this);
        this._onTouchStartBound = this._onTouchStart.bind(this);
        this._onTouchEndBound = this._onTouchEnd.bind(this);

        if (context && Object.keys(context).length > 0 && optionsAutoInit(context)) {
            this.initialize(context);
        }
    }

    /**
     * Initializes the InteractionSystem with the global application context.
     *
     * @param {Object} context - Engine context containing scene, camera, renderer, eventBus, managers.
     * @returns {InteractionSystem} returns this instance for chaining.
     */
    initialize(context = {}) {
        if (this._initialized) {
            console.warn('InteractionSystem: Already initialized.');
            return this;
        }

        this._context = { ...this._context, ...context };
        if (this._context.eventBus) {
            this._eventBus = this._context.eventBus;
        }

        if (typeof THREE !== 'undefined') {
            this._raycaster = new THREE.Raycaster();
        }

        this._subscribeEvents();
        this._initialized = true;

        console.log('InteractionSystem: Initialized with context.');
        return this;
    }

    /**
     * Activates the interaction system processing and binds DOM input listeners.
     */
    activate() {
        if (!this._initialized) {
            console.warn('InteractionSystem: Must call initialize() before activate().');
            return;
        }

        if (this._enabled) return;

        this._enabled = true;
        this._active = true;

        this._bindDOMInputListeners();
        this._emit('INTERACTION_ENABLED', { timestamp: performance.now() });

        console.log('InteractionSystem: Activated.');
    }

    /**
     * Deactivates the interaction system processing and unbinds DOM input listeners.
     */
    deactivate() {
        if (!this._enabled) return;

        this._unbindDOMInputListeners();

        // Clear hover and selection states
        if (this._hoveredTarget) {
            this._emit('OBJECT_HOVER', { ...this._hoveredTarget, isHovered: false });
            this._hoveredTarget = null;
        }
        this._selectedTarget = null;

        this._enabled = false;
        this._active = false;

        this._emit('INTERACTION_DISABLED', { timestamp: performance.now() });
        console.log('InteractionSystem: Deactivated.');
    }

    /**
     * Synonym for activate().
     */
    enable() {
        this.activate();
    }

    /**
     * Synonym for deactivate().
     */
    disable() {
        this.deactivate();
    }

    /**
     * Registers a custom interaction callback for a specific interaction type.
     *
     * @param {string} type - Interaction type identifier (e.g., 'select', 'hover', 'click', 'gesture', 'proximity').
     * @param {Function} callback - Callback function (eventData) => void.
     */
    registerInteraction(type, callback) {
        if (!type || typeof callback !== 'function') {
            throw new Error('InteractionSystem.registerInteraction: valid type and callback function required.');
        }
        this._customHandlers.set(type, callback);
        console.log(`InteractionSystem: Registered custom interaction handler for "${type}".`);
    }

    /**
     * Unregisters a custom interaction handler callback.
     *
     * @param {string} type - Interaction type identifier.
     * @returns {boolean} True if handler existed and was removed.
     */
    unregisterInteraction(type) {
        const removed = this._customHandlers.delete(type);
        if (removed) {
            console.log(`InteractionSystem: Unregistered interaction handler for "${type}".`);
        }
        return removed;
    }

    /**
     * Releases all input listeners, EventBus subscriptions, registries, and memory references.
     */
    dispose() {
        this.deactivate();
        this._unsubscribeEvents();

        this._activeAnchors.clear();
        this._activeObjects.clear();
        this._customHandlers.clear();

        this._raycaster = null;
        this._hoveredTarget = null;
        this._selectedTarget = null;
        this._domElement = null;
        this._context = null;
        this._eventBus = null;
        this._initialized = false;

        console.log('InteractionSystem: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  Private — EventBus Subscriptions & Event Handlers
    // ------------------------------------------------------------------ //

    /**
     * Subscribes to required EventBus lifecycle and tracking events.
     * @private
     */
    _subscribeEvents() {
        if (!this._eventBus) return;

        const listen = (evt, fn) => {
            this._eventBus.on(evt, fn);
            this._listeners.push({ evt, fn });
        };

        // TrackerManager Lifecycle Events
        listen('OBJECT_ADDED', (data) => this._onObjectAdded(data));
        listen('OBJECT_UPDATED', (data) => this._onObjectUpdated(data));
        listen('OBJECT_REMOVED', (data) => this._onObjectRemoved(data));

        // AnchorManager Lifecycle Events
        listen('ANCHOR_CREATED', (data) => this._onAnchorCreated(data));
        listen('ANCHOR_UPDATED', (data) => this._onAnchorUpdated(data));
        listen('ANCHOR_REMOVED', (data) => this._onAnchorRemoved(data));

        // LessonManager Lifecycle Events
        listen('LESSON_ACTIVATED', (data) => {
            this._activeLessonId = data?.id || null;
            this._triggerCustomHandler('lesson_activated', data);
        });

        listen('LESSON_DEACTIVATED', () => {
            this._activeLessonId = null;
            this._triggerCustomHandler('lesson_deactivated', {});
        });

        // SceneManager Render Frame Event (Single Shared Update Loop)
        listen('RENDER_FRAME', (data) => this._onRenderFrame(data));
    }

    /**
     * Unsubscribes all EventBus listeners.
     * @private
     */
    _unsubscribeEvents() {
        if (!this._eventBus) return;
        for (const { evt, fn } of this._listeners) {
            this._eventBus.off(evt, fn);
        }
        this._listeners = [];
    }

    /**
     * Handles OBJECT_ADDED events from TrackerManager.
     * @private
     */
    _onObjectAdded(data) {
        if (data?.tagId !== undefined) {
            this._activeObjects.set(data.tagId, data.trackedObject || {});
            this._notifyOrchestration('object_added', data);
        }
    }

    /**
     * Handles OBJECT_UPDATED events from TrackerManager.
     * @private
     */
    _onObjectUpdated(data) {
        if (data?.tagId !== undefined) {
            this._activeObjects.set(data.tagId, data.trackedObject || {});
            this._processMarkerInteractions(data);
        }
    }

    /**
     * Handles OBJECT_REMOVED events from TrackerManager.
     * @private
     */
    _onObjectRemoved(data) {
        if (data?.tagId !== undefined) {
            this._activeObjects.delete(data.tagId);
            if (this._selectedTarget?.tagId === data.tagId) {
                this._selectedTarget = null;
            }
            if (this._hoveredTarget?.tagId === data.tagId) {
                this._hoveredTarget = null;
            }
            this._notifyOrchestration('object_removed', data);
        }
    }

    /**
     * Handles ANCHOR_CREATED events from AnchorManager.
     * @private
     */
    _onAnchorCreated(data) {
        if (data?.tagId !== undefined && data.anchor) {
            this._activeAnchors.set(data.tagId, { anchor: data.anchor, parentId: data.parentId });
            this._notifyOrchestration('anchor_created', data);
        }
    }

    /**
     * Handles ANCHOR_UPDATED events from AnchorManager.
     * @private
     */
    _onAnchorUpdated(data) {
        if (data?.tagId !== undefined && data.anchor) {
            this._activeAnchors.set(data.tagId, { anchor: data.anchor, parentId: data.parentId });
        }
    }

    /**
     * Handles ANCHOR_REMOVED events from AnchorManager.
     * @private
     */
    _onAnchorRemoved(data) {
        if (data?.tagId !== undefined) {
            this._activeAnchors.delete(data.tagId);
            this._notifyOrchestration('anchor_removed', data);
        }
    }

    /**
     * Processed per-frame in the existing RENDER_FRAME loop.
     * Runs raycasting/pointer-picking and physical marker proximity evaluation.
     * @private
     */
    _onRenderFrame(data) {
        if (!this._enabled) return;

        // Perform raycasting test if pointer is active and camera/scene are available
        if (this._pointerVector.x !== -999 && this._context?.camera && this._context?.scene) {
            this._processRaycasting();
        }
    }

    // ------------------------------------------------------------------ //
    //  Private — Raycasting & Pointer Picking
    // ------------------------------------------------------------------ //

    /**
     * Tests raycast intersections against active Three.js Object3D anchors.
     * @private
     */
    _processRaycasting() {
        if (!this._raycaster || !this._context?.camera || !this._context?.scene) return;

        // Ensure world matrices are up to date for ray intersection tests
        if (typeof this._context.scene.updateMatrixWorld === 'function') {
            this._context.scene.updateMatrixWorld(true);
        }

        this._raycaster.setFromCamera(this._pointerVector, this._context.camera);

        const targetsToIntersect = [];
        for (const [tagId, record] of this._activeAnchors) {
            if (record.anchor && record.anchor.visible !== false) {
                targetsToIntersect.push(record.anchor);
            }
        }

        if (targetsToIntersect.length === 0) {
            if (this._hoveredTarget) {
                this._emit('OBJECT_HOVER', { ...this._hoveredTarget, isHovered: false });
                this._hoveredTarget = null;
            }
            return;
        }

        const intersects = this._raycaster.intersectObjects(targetsToIntersect, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitAnchorRecord = this._findAnchorForObject(hit.object);

            if (hitAnchorRecord) {
                const hoverData = {
                    tagId: hitAnchorRecord.tagId,
                    anchor: hitAnchorRecord.anchor,
                    object: hit.object,
                    point: hit.point,
                    distance: hit.distance,
                    isHovered: true,
                };

                if (!this._hoveredTarget || this._hoveredTarget.tagId !== hitAnchorRecord.tagId) {
                    if (this._hoveredTarget) {
                        this._emit('OBJECT_HOVER', { ...this._hoveredTarget, isHovered: false });
                    }
                    this._hoveredTarget = hoverData;
                    this._emit('OBJECT_HOVER', hoverData);
                    this._triggerCustomHandler('hover', hoverData);
                }
            }
        } else {
            if (this._hoveredTarget) {
                this._emit('OBJECT_HOVER', { ...this._hoveredTarget, isHovered: false });
                this._hoveredTarget = null;
            }
        }
    }

    /**
     * Traverses up an Object3D hierarchy to find its corresponding root anchor record.
     * @private
     */
    _findAnchorForObject(obj) {
        let curr = obj;
        while (curr) {
            for (const [tagId, record] of this._activeAnchors) {
                if (record.anchor === curr) {
                    return { tagId, anchor: record.anchor };
                }
            }
            curr = curr.parent;
        }
        return null;
    }

    // ------------------------------------------------------------------ //
    //  Private — Physical Marker & Orchestration Handlers
    // ------------------------------------------------------------------ //

    /**
     * Evaluates physical marker orientation, distance, and proximity updates.
     * Notifies LessonManager, FormulaEngine, and AnimationEngine via EventBus.
     * @private
     */
    _processMarkerInteractions(data) {
        const { tagId, trackedObject } = data;
        const pose = trackedObject?.latestPose;

        if (!pose) return;

        const payload = {
            tagId,
            lessonId: this._activeLessonId,
            pose,
            state: trackedObject.state,
        };

        // Notify downstream lesson/formula/animation engines
        this._emit('LESSON_INTERACTION', {
            type: 'marker_update',
            tagId,
            lessonId: this._activeLessonId,
            payload,
        });

        this._triggerCustomHandler('proximity', payload);
    }

    /**
     * Helper to broadcast orchestration events to LessonManager, FormulaEngine, AnimationEngine via EventBus.
     * @private
     */
    _notifyOrchestration(type, data) {
        this._emit('LESSON_INTERACTION', {
            type,
            tagId: data.tagId,
            lessonId: this._activeLessonId,
            payload: data,
        });
        this._triggerCustomHandler(type, data);
    }

    /**
     * Triggers registered custom interaction handlers if present.
     * @private
     */
    _triggerCustomHandler(type, data) {
        if (this._customHandlers.has(type)) {
            try {
                this._customHandlers.get(type)(data);
            } catch (err) {
                console.error(`InteractionSystem: Error in custom handler for "${type}":`, err);
            }
        }
    }

    // ------------------------------------------------------------------ //
    //  Private — DOM Input Listeners (Pointer, Touch, Extension Points)
    // ------------------------------------------------------------------ //

    /**
     * Binds mouse and touch DOM event listeners.
     * @private
     */
    _bindDOMInputListeners() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const el = this._context?.renderer?.domElement || document.getElementById('ar-canvas-container') || window;
        this._domElement = el;

        el.addEventListener('pointermove', this._onPointerMoveBound);
        el.addEventListener('pointerdown', this._onPointerDownBound);
        el.addEventListener('pointerup', this._onPointerUpBound);
        el.addEventListener('pointerleave', this._onPointerLeaveBound);

        el.addEventListener('touchstart', this._onTouchStartBound, { passive: true });
        el.addEventListener('touchend', this._onTouchEndBound, { passive: true });
    }

    /**
     * Unbinds mouse and touch DOM event listeners.
     * @private
     */
    _unbindDOMInputListeners() {
        if (!this._domElement) return;

        const el = this._domElement;
        el.removeEventListener('pointermove', this._onPointerMoveBound);
        el.removeEventListener('pointerdown', this._onPointerDownBound);
        el.removeEventListener('pointerup', this._onPointerUpBound);
        el.removeEventListener('pointerleave', this._onPointerLeaveBound);

        el.removeEventListener('touchstart', this._onTouchStartBound);
        el.removeEventListener('touchend', this._onTouchEndBound);
    }

    /**
     * Handles pointer move events and updates normalized device coordinates (-1 to +1).
     * @private
     */
    _onPointerMove(e) {
        if (!this._enabled) return;

        const rect = this._getDOMRect();
        this._pointerVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointerVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    /**
     * Handles pointer down events.
     * @private
     */
    _onPointerDown(e) {
        if (!this._enabled) return;
        this._onPointerMove(e);

        if (this._hoveredTarget) {
            this._selectedTarget = { ...this._hoveredTarget };
            this._emit('OBJECT_SELECTED', {
                tagId: this._selectedTarget.tagId,
                anchor: this._selectedTarget.anchor,
                object: this._selectedTarget.object,
            });
            this._triggerCustomHandler('select', this._selectedTarget);
        }
    }

    /**
     * Handles pointer up events.
     * @private
     */
    _onPointerUp(e) {
        if (!this._enabled) return;

        if (this._hoveredTarget) {
            const clickData = {
                tagId: this._hoveredTarget.tagId,
                anchor: this._hoveredTarget.anchor,
                object: this._hoveredTarget.object,
                point: this._hoveredTarget.point,
            };

            this._emit('OBJECT_CLICKED', clickData);
            this._triggerCustomHandler('click', clickData);
        }
    }

    /**
     * Handles pointer leave events.
     * @private
     */
    _onPointerLeave() {
        this._pointerVector.set(-999, -999);
        if (this._hoveredTarget) {
            this._emit('OBJECT_HOVER', { ...this._hoveredTarget, isHovered: false });
            this._hoveredTarget = null;
        }
    }

    /**
     * Extension point for touch start events.
     * @private
     */
    _onTouchStart(e) {
        if (!this._enabled || !e.touches || e.touches.length === 0) return;
        const touch = e.touches[0];
        this._onPointerDown({ clientX: touch.clientX, clientY: touch.clientY });

        if (e.touches.length > 1) {
            this._processMultiTouch(e.touches);
        }
    }

    /**
     * Extension point for touch end events.
     * @private
     */
    _onTouchEnd(e) {
        if (!this._enabled) return;
        this._onPointerUp({});
    }

    // ------------------------------------------------------------------ //
    //  Extension Points (XR Controllers, Gestures, Multi-Touch)
    // ------------------------------------------------------------------ //

    /**
     * Future Extension Point: Multi-touch gesture processing (pinch, zoom, rotate).
     * @param {TouchList} touches
     * @private
     */
    _processMultiTouch(touches) {
        this._triggerCustomHandler('multitouch', { count: touches.length, touches });
    }

    /**
     * Future Extension Point: Gesture recognition (swipe, tap, hold).
     * @param {Object} gestureData
     * @private
     */
    _processGestures(gestureData) {
        this._triggerCustomHandler('gesture', gestureData);
    }

    /**
     * Future Extension Point: WebXR controller interactions.
     * @param {Object} xrInputData
     * @private
     */
    _processXRInput(xrInputData) {
        this._triggerCustomHandler('xr_input', xrInputData);
    }

    /**
     * Helper to compute bounding client rect for coordinate normalization.
     * @private
     */
    _getDOMRect() {
        if (this._domElement && typeof this._domElement.getBoundingClientRect === 'function') {
            return this._domElement.getBoundingClientRect();
        }
        return { left: 0, top: 0, width: typeof window !== 'undefined' ? window.innerWidth : 1280, height: typeof window !== 'undefined' ? window.innerHeight : 720 };
    }

    /**
     * Helper to emit EventBus events safely.
     * @private
     */
    _emit(evt, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(evt, payload);
        }
    }
}

function optionsAutoInit(ctx) {
    return ctx.autoInitialize !== false;
}
