/**
 * SceneManager.js - Three.js Rendering Environment Manager
 *
 * Responsibility:
 * - Creates and owns the Three.js Scene, PerspectiveCamera, and WebGLRenderer.
 * - Configures transparent alpha blending so 3D models render as an AR
 *   overlay on top of the live camera video feed.
 * - Handles browser window resize events (desktop and mobile).
 * - Manages the device pixel ratio correctly for retina / high-DPI displays
 *   while capping at a configurable maximum to prevent GPU overload on
 *   low-end Chromebooks.
 * - Drives the requestAnimationFrame render loop.
 * - Emits render lifecycle events for downstream consumers.
 * - Disposes all GPU resources correctly on teardown.
 *
 * Public API:
 * - initialize(container, options?)
 * - start()
 * - stop()
 * - resize()
 * - render()
 * - dispose()
 *
 * Events emitted via EventBus:
 * - SCENE_READY        { scene, camera, renderer, width, height }
 * - RENDER_STARTED     { }
 * - RENDER_STOPPED     { }
 * - RENDER_FRAME       { deltaTime, frameCount }
 *
 * Dependencies:
 * - three (v0.170+)
 *
 * NOTE: This module does NOT load models, track markers, anchor objects,
 * implement lesson logic, implement animations, or implement formulas.
 * It provides the raw rendering surface and loop only.
 */

import * as THREE from 'three';

// --------------------------------------------------------------------------- //
//  Constants
// --------------------------------------------------------------------------- //

/**
 * Default camera configuration for AR overlay.
 *
 * The field of view is set to 60° which closely matches a typical
 * smartphone camera (~65-70°).  This can be overridden via initialize().
 */
const DEFAULT_CAMERA = Object.freeze({
    fov: 60,
    near: 0.01,   // 1 cm — close enough for tabletop objects.
    far: 100,     // 100 m — more than sufficient for indoor use.
});

/**
 * Default renderer configuration.
 *
 * - alpha: true enables transparent background so the camera video
 *   underneath remains visible.
 * - antialias: true reduces jagged edges on geometry.
 * - powerPreference: 'high-performance' asks the browser to use the
 *   discrete GPU when available (important on Chromebooks with both
 *   integrated and discrete GPUs).
 */
const DEFAULT_RENDERER = Object.freeze({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
});

/**
 * Maximum pixel ratio cap.
 *
 * Retina displays report a devicePixelRatio of 2-3.  Rendering at
 * native resolution on a 3x display triples GPU load for marginal
 * visual benefit at 640x480 AR model sizes.  We cap at 2x to balance
 * quality and performance.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * Default render loop target: 60fps.
 *
 * We use a delta-time approach rather than fixed timestep so that
 * animation modules downstream can compute their own interpolation.
 */
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

// --------------------------------------------------------------------------- //
//  Types (JSDoc for IDE / linter support)
// --------------------------------------------------------------------------- //

/**
 * @typedef {Object} SceneManagerOptions
 * @property {number}   [cameraFov=60]              - PerspectiveCamera FOV in degrees.
 * @property {number}   [cameraNear=0.01]           - Near clipping plane in metres.
 * @property {number}   [cameraFar=100]             - Far clipping plane in metres.
 * @property {boolean}  [alpha=true]                - Renderer alpha (transparency) toggle.
 * @property {boolean}  [antialias=true]            - MSAA antialiasing toggle.
 * @property {number}   [maxPixelRatio=2]           - Maximum devicePixelRatio multiplier.
 * @property {string}   [powerPreference='high-performance'] - WebGL context hint.
 */

// --------------------------------------------------------------------------- //
//  Implementation
// --------------------------------------------------------------------------- //

export class SceneManager {

    // ------------------------------------------------------------------ //
    //  Construction
    // ------------------------------------------------------------------ //

    /**
     * @param {EventBus} eventBus - The global pub/sub event bus.
     */
    constructor(eventBus) {
        this._eventBus = eventBus;

        // Core Three.js objects (null until initialize() is called).
        this._scene    = null;
        this._camera   = null;
        this._renderer = null;

        // Render loop state.
        this._running  = false;
        this._rafId    = null;
        this._lastTime = 0;
        this._frameCount = 0;

        // Resize handling.
        this._resizeObserver = null;
        this._container      = null;
    }

    // ------------------------------------------------------------------ //
    //  Public API
    // ------------------------------------------------------------------ //

    /**
     * Initializes the Three.js rendering environment inside a DOM container.
     *
     * The renderer canvas is appended to `container` and sized to fill it
     * completely.  The camera is positioned at the origin looking down the
     * negative Z axis (default Three.js convention).
     *
     * After successful initialization the SCENE_READY event is emitted with
     * references to the scene, camera, and renderer for downstream modules
     * (ObjectLoader, AnchorManager, Lighting) to consume.
     *
     * @param {HTMLElement} container - The DOM element to mount the canvas into.
     * @param {SceneManagerOptions} [options] - Optional configuration overrides.
     */
    initialize(container, options = {}) {
        if (this._renderer) {
            console.warn('SceneManager: Already initialized. Call dispose() first to reinitialize.');
            return;
        }

        if (!container) {
            throw new Error('SceneManager: container element is required.');
        }

        this._container = container;

        // ── Merge options with defaults ──
        const cameraOpts = { ...DEFAULT_CAMERA, ...options };
        const rendererOpts = { ...DEFAULT_RENDERER, ...options };
        const maxPixelRatio = options.maxPixelRatio ?? MAX_PIXEL_RATIO;

        // ── Scene ──
        this._scene = new THREE.Scene();

        // ── PerspectiveCamera ──
        // Dimensions will be set in resize() once the container is measured.
        this._camera = new THREE.PerspectiveCamera(
            cameraOpts.fov,
            1, // placeholder aspect ratio — updated in resize()
            cameraOpts.near,
            cameraOpts.far,
        );
        this._camera.position.set(0, 0, 0);

        // ── WebGLRenderer ──
        this._renderer = new THREE.WebGLRenderer({
            alpha:             rendererOpts.alpha,
            antialias:         rendererOpts.antialias,
            powerPreference:   rendererOpts.powerPreference,
        });

        // Ensure the renderer context is configured for transparent output.
        this._renderer.setClearColor(0x000000, 0); // fully transparent
        this._renderer.setSize(1, 1); // placeholder — updated in resize()
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));

        // Append the canvas to the container.
        this._container.appendChild(this._renderer.domElement);

        // Bind ResizeObserver to handle canvas & camera aspect ratio updates on window/container resize.
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                this.resize();
            });
            this._resizeObserver.observe(this._container);
        }

        // Size everything to the container.
        this.resize();

        // Emit SCENE_READY for downstream consumers.
        const { width, height } = this._renderer.domElement.getBoundingClientRect();
        this._eventBus.emit('SCENE_READY', {
            scene:    this._scene,
            camera:   this._camera,
            renderer: this._renderer,
            width:    Math.round(width),
            height:   Math.round(height),
        });

        console.log(
            `SceneManager: Initialized — ${Math.round(width)}x${Math.round(height)} @ ` +
            `${this._renderer.getPixelRatio().toFixed(1)}x DPR, alpha=${rendererOpts.alpha}`,
        );
    }

    /**
     * Starts the render loop.
     *
     * Uses requestAnimationFrame with a delta-time accumulator so the
     * loop can be paused and resumed without frame drift.
     */
    start() {
        if (this._running) return;
        if (!this._renderer) {
            throw new Error('SceneManager: Must call initialize() before start().');
        }

        this._running = true;
        this._lastTime = performance.now();
        this._frameCount = 0;

        this._eventBus.emit('RENDER_STARTED', {});
        this._loop();
    }

    /**
     * Stops the render loop.
     *
     * The current frame completes but no new frames are scheduled.
     */
    stop() {
        if (!this._running) return;

        this._running = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this._eventBus.emit('RENDER_STOPPED', {});
    }

    /**
     * Resizes the renderer and camera to match the container dimensions.
     *
     * This is called automatically when the browser window is resized
     * (via a ResizeObserver).  It can also be called manually if the
     * container is resized programmatically (e.g. UI overlay changes).
     *
     * The renderer's pixel ratio is re-evaluated in case the device
     * pixel ratio changed (e.g. user moved the window to a different
     * display with a different DPI).
     */
    resize() {
        if (!this._container || !this._renderer || !this._camera) return;

        const rect = this._container.getBoundingClientRect();
        const width  = Math.round(rect.width);
        const height = Math.round(rect.height);

        if (width === 0 || height === 0) {
            // Container is hidden or zero-sized — skip resize.
            return;
        }

        // Update the renderer size.
        this._renderer.setSize(width, height, true);

        // Re-evaluate pixel ratio (e.g. after moving to a different display).
        this._renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
        );

        // Update camera aspect ratio and projection matrix.
        this._camera.aspect = width / height;
        this._camera.updateProjectionMatrix();
    }

    /**
     * Updates the camera's vertical FOV to match real camera intrinsics.
     * Called by App.js when the webcam stream is ready with actual dimensions.
     *
     * @param {number} vfovDegrees - Vertical field of view in degrees.
     */
    setCameraFov(vfovDegrees) {
        if (!this._camera) return;
        this._camera.fov = vfovDegrees;
        this._camera.updateProjectionMatrix();
    }

    /**
     * Manually triggers a single render pass.
     *
     * Useful for snapshotting the scene without running the continuous
     * render loop (e.g. for screenshots or headless testing).
     */
    render() {
        if (!this._renderer || !this._scene || !this._camera) return;

        this._renderer.render(this._scene, this._camera);
    }

    /**
     * Releases all GPU resources and DOM references held by the manager.
     *
     * After dispose() the manager cannot be reused.  Create a new instance
     * if you need to reinitialize.
     *
     * This method:
     * 1. Stops the render loop.
     * 2. Removes the ResizeObserver.
     * 3. Disposes the WebGLRenderer (releases all WebGL contexts, textures,
     *    geometries, and materials owned by the renderer).
     * 4. Removes the canvas element from the DOM.
     * 5. Nullifies all internal references.
     */
    dispose() {
        this.stop();

        // Disconnect resize observer.
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        // Dispose the renderer — this is the key GPU cleanup call.
        // Three.js's dispose() releases the WebGL context and all
        // internally managed resources.
        if (this._renderer) {
            this._renderer.dispose();
        }

        // Remove the canvas from the DOM.
        if (this._container && this._renderer?.domElement?.parentNode) {
            this._container.removeChild(this._renderer.domElement);
        }

        // Nullify all references.
        this._scene    = null;
        this._camera   = null;
        this._renderer = null;
        this._container = null;

        console.log('SceneManager: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  Private — Render Loop
    // ------------------------------------------------------------------ //

    /**
     * The main RAF-based render loop.
     *
     * Uses a delta-time approach:
     * - Each frame computes the elapsed time since the last frame.
     * - The render() call is made once per frame regardless of delta.
     * - The RENDER_FRAME event carries deltaTime so animation modules
     *   can interpolate smoothly.
     *
     * @private
     */
    _loop() {
        if (!this._running) return;

        this._rafId = requestAnimationFrame((now) => {
            const deltaTime = now - this._lastTime;
            this._lastTime = now;
            this._frameCount++;

            // Render the scene.
            if (this._scene && this._camera && this._renderer) {
                this._renderer.render(this._scene, this._camera);
            }

            // Emit per-frame event with timing data.
            this._eventBus.emit('RENDER_FRAME', {
                deltaTime,
                frameCount: this._frameCount,
            });

            this._loop();
        });
    }
}
