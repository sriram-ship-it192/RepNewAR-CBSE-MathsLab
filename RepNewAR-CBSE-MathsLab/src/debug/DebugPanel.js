/**
 * DebugPanel.js - Real-Time AR Engine Debug Overlay
 *
 * Responsibility:
 * - Provides a lightweight, real-time visual debug overlay monitoring engine metrics.
 * - Decoupled completely via EventBus — listens to events without direct access to manager internals.
 * - Displays FPS, frame time, camera status, resolution, tracking state, AprilTag IDs,
 *   pose confidence, active anchors, model counts, and WebGL renderer stats.
 * - Supports keyboard toggle via 'D' key press.
 * - Can be disabled for production via a single configuration flag (`options.enabled = false`).
 *
 * Public API:
 * - initialize(options?)
 * - show()
 * - hide()
 * - toggle()
 * - dispose()
 */
export class DebugPanel {
    /**
     * @param {EventBus|null} [eventBus=null] - The global pub/sub event bus.
     * @param {Object} [options={}] - Configuration options.
     * @param {boolean} [options.enabled=true] - Master toggle for production builds.
     * @param {boolean} [options.visible=true] - Initial visibility state.
     * @param {string} [options.engineVersion='1.0.0'] - Engine version string.
     */
    constructor(eventBus = null, options = {}) {
        this._eventBus = eventBus;
        this._container = null;
        this._visible = false;
        this._renderer = null;

        // Metric States
        this._fps = 0;
        this._frameTime = 0;
        this._frameCount = 0;
        this._lastFpsTime = performance.now();
        this._fpsFrames = 0;

        this._activeCamera = 'Inactive';
        this._cameraResolution = 'N/A';
        this._trackingStatus = 'IDLE';

        this._visibleTags = new Map(); // tagId -> { confidence, lastSeen }
        this._trackerStates = new Map(); // tagId -> state
        this._activeAnchors = new Set(); // set of tagIds

        this._loadedModels = new Set();
        this._cachedModels = new Set();
        this._pendingModels = new Set();

        this._listeners = [];

        this._options = {
            enabled: true,
            visible: true,
            engineVersion: '1.0.0',
            ...options,
        };

        if (options.autoInitialize !== false && this._options.enabled) {
            this.initialize(this._options);
        }
    }

    /**
     * Initializes the debug overlay DOM element, EventBus subscriptions, and keyboard handlers.
     *
     * @param {Object} [options={}] - Configuration overrides.
     * @returns {DebugPanel}
     */
    initialize(options = {}) {
        this._options = { ...this._options, ...options };

        if (!this._options.enabled) {
            this.hide();
            return this;
        }

        this._createDOM();
        this._subscribeEvents();
        this._bindKeyboard();

        if (this._options.visible !== false) {
            this.show();
        } else {
            this.hide();
        }

        return this;
    }

    /**
     * Shows the debug overlay.
     */
    show() {
        if (!this._options.enabled) return;
        this._visible = true;
        if (this._container) {
            this._container.style.display = 'block';
        }
    }

    /**
     * Hides the debug overlay.
     */
    hide() {
        this._visible = false;
        if (this._container) {
            this._container.style.display = 'none';
        }
    }

    /**
     * Toggles visibility of the debug overlay.
     */
    toggle() {
        if (this._visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Releases DOM elements and unsubscribes all event listeners.
     */
    dispose() {
        this.hide();
        this._unsubscribeEvents();
        this._unbindKeyboard();

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }

        this._container = null;
        this._renderer = null;
        this._visibleTags.clear();
        this._trackerStates.clear();
        this._activeAnchors.clear();
        this._loadedModels.clear();
        this._cachedModels.clear();
        this._pendingModels.clear();
    }

    // ------------------------------------------------------------------ //
    //  Private — DOM & Styling
    // ------------------------------------------------------------------ //

    /**
     * Creates and mounts the debug overlay DOM element.
     * @private
     */
    _createDOM() {
        if (this._container) return;

        // Inject stylesheet for debug panel
        if (!document.getElementById('ar-debug-panel-styles')) {
            const style = document.createElement('style');
            style.id = 'ar-debug-panel-styles';
            style.textContent = `
                #ar-debug-panel {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 290px;
                    max-height: calc(100vh - 20px);
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.85);
                    border: 1px solid #00ff66;
                    border-radius: 6px;
                    color: #00ff66;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 11px;
                    line-height: 1.4;
                    padding: 10px 12px;
                    box-shadow: 0 4px 16px rgba(0, 255, 102, 0.15);
                    z-index: 999999;
                    pointer-events: auto;
                    user-select: none;
                    box-sizing: border-box;
                }
                #ar-debug-panel header {
                    font-weight: bold;
                    font-size: 12px;
                    border-bottom: 1px solid rgba(0, 255, 102, 0.3);
                    padding-bottom: 4px;
                    margin-bottom: 6px;
                    display: flex;
                    justify-content: space-between;
                    color: #00ff66;
                }
                #ar-debug-panel .debug-sec {
                    margin-bottom: 6px;
                }
                #ar-debug-panel .debug-sec-title {
                    color: #88ffbb;
                    font-weight: bold;
                    margin-bottom: 2px;
                    text-transform: uppercase;
                    font-size: 10px;
                    letter-spacing: 0.5px;
                }
                #ar-debug-panel .debug-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 1px;
                }
                #ar-debug-panel .debug-label {
                    color: #aaffcc;
                }
                #ar-debug-panel .debug-val {
                    color: #00ff66;
                    font-weight: bold;
                }
            `;
            document.head.appendChild(style);
        }

        this._container = document.createElement('div');
        this._container.id = 'ar-debug-panel';
        this._container.innerHTML = `
            <header>
                <span>AR ENGINE DEBUG</span>
                <span id="dbg-ver">v${this._options.engineVersion}</span>
            </header>
            <div class="debug-sec">
                <div class="debug-sec-title">Performance</div>
                <div class="debug-row"><span class="debug-label">FPS:</span><span class="debug-val" id="dbg-fps">0</span></div>
                <div class="debug-row"><span class="debug-label">Frame Time:</span><span class="debug-val" id="dbg-ftime">0.0 ms</span></div>
                <div class="debug-row"><span class="debug-label">Memory Heap:</span><span class="debug-val" id="dbg-mem">N/A</span></div>
            </div>
            <div class="debug-sec">
                <div class="debug-sec-title">Camera & Display</div>
                <div class="debug-row"><span class="debug-label">Active Camera:</span><span class="debug-val" id="dbg-cam">Inactive</span></div>
                <div class="debug-row"><span class="debug-label">Resolution:</span><span class="debug-val" id="dbg-camres">N/A</span></div>
                <div class="debug-row"><span class="debug-label">Screen Res:</span><span class="debug-val" id="dbg-screen">0x0</span></div>
                <div class="debug-row"><span class="debug-label">DPR:</span><span class="debug-val" id="dbg-dpr">1.0</span></div>
            </div>
            <div class="debug-sec">
                <div class="debug-sec-title">Tracking & Anchors</div>
                <div class="debug-row"><span class="debug-label">Status:</span><span class="debug-val" id="dbg-trstatus">IDLE</span></div>
                <div class="debug-row"><span class="debug-label">Visible Tags:</span><span class="debug-val" id="dbg-tagcount">0</span></div>
                <div class="debug-row"><span class="debug-label">Current Tag IDs:</span><span class="debug-val" id="dbg-tagids">[]</span></div>
                <div class="debug-row"><span class="debug-label">Pose Confidence:</span><span class="debug-val" id="dbg-conf">N/A</span></div>
                <div class="debug-row"><span class="debug-label">Tracker State:</span><span class="debug-val" id="dbg-trstate">IDLE</span></div>
                <div class="debug-row"><span class="debug-label">Active Anchors:</span><span class="debug-val" id="dbg-anchors">0</span></div>
            </div>
            <div class="debug-sec">
                <div class="debug-sec-title">Asset Loading</div>
                <div class="debug-row"><span class="debug-label">Loaded Models:</span><span class="debug-val" id="dbg-loadedm">0</span></div>
                <div class="debug-row"><span class="debug-label">Cached Models:</span><span class="debug-val" id="dbg-cachedm">0</span></div>
                <div class="debug-row"><span class="debug-label">Pending Loads:</span><span class="debug-val" id="dbg-pendingm">0</span></div>
            </div>
            <div class="debug-sec">
                <div class="debug-sec-title">WebGL Renderer</div>
                <div class="debug-row"><span class="debug-label">WebGL Version:</span><span class="debug-val" id="dbg-webglver">WebGL 2.0</span></div>
                <div class="debug-row"><span class="debug-label">Draw Calls:</span><span class="debug-val" id="dbg-drawcalls">0</span></div>
                <div class="debug-row"><span class="debug-label">Triangles:</span><span class="debug-val" id="dbg-triangles">0</span></div>
                <div class="debug-row"><span class="debug-label">Geometries:</span><span class="debug-val" id="dbg-geometries">0</span></div>
                <div class="debug-row"><span class="debug-label">Textures:</span><span class="debug-val" id="dbg-textures">0</span></div>
            </div>
            <div style="font-size:9px; color:#55bb77; text-align:center; margin-top:4px;">
                Press [D] to show/hide overlay
            </div>
        `;

        document.body.appendChild(this._container);

        // Cache element references for fast direct text updates
        this._els = {
            fps: this._container.querySelector('#dbg-fps'),
            fTime: this._container.querySelector('#dbg-ftime'),
            mem: this._container.querySelector('#dbg-mem'),
            cam: this._container.querySelector('#dbg-cam'),
            camRes: this._container.querySelector('#dbg-camres'),
            screen: this._container.querySelector('#dbg-screen'),
            dpr: this._container.querySelector('#dbg-dpr'),
            trStatus: this._container.querySelector('#dbg-trstatus'),
            tagCount: this._container.querySelector('#dbg-tagcount'),
            tagIds: this._container.querySelector('#dbg-tagids'),
            conf: this._container.querySelector('#dbg-conf'),
            trState: this._container.querySelector('#dbg-trstate'),
            anchors: this._container.querySelector('#dbg-anchors'),
            loadedM: this._container.querySelector('#dbg-loadedm'),
            cachedM: this._container.querySelector('#dbg-cachedm'),
            pendingM: this._container.querySelector('#dbg-pendingm'),
            webglVer: this._container.querySelector('#dbg-webglver'),
            drawCalls: this._container.querySelector('#dbg-drawcalls'),
            triangles: this._container.querySelector('#dbg-triangles'),
            geometries: this._container.querySelector('#dbg-geometries'),
            textures: this._container.querySelector('#dbg-textures'),
        };
    }

    // ------------------------------------------------------------------ //
    //  Private — Event Subscriptions & Monitoring
    // ------------------------------------------------------------------ //

    /**
     * Subscribes to EventBus events to maintain internal debug states.
     * @private
     */
    _subscribeEvents() {
        if (!this._eventBus) return;

        const listen = (evt, fn) => {
            this._eventBus.on(evt, fn);
            this._listeners.push({ evt, fn });
        };

        // Render Frame Loop
        listen('RENDER_FRAME', (data) => {
            this._updateMetrics(data.deltaTime);
            if (this._visible) {
                this._renderUI();
            }
        });

        // Scene & Renderer Ready
        listen('SCENE_READY', (data) => {
            this._renderer = data.renderer || null;
        });

        // Camera Events
        listen('CAMERA_READY', (data) => this._onCameraStream(data));
        listen('CAMERA_SWITCHED', (data) => this._onCameraStream(data));
        listen('CAMERA_STOPPED', () => {
            this._activeCamera = 'Inactive';
            this._cameraResolution = 'N/A';
        });

        // Tracking Events
        listen('TRACKING_STARTED', () => { this._trackingStatus = 'ACTIVE'; });
        listen('TRACKING_STOPPED', () => { this._trackingStatus = 'STOPPED'; });
        listen('TAG_DETECTED', (data) => this._onTagSeen(data));
        listen('TAG_UPDATED', (data) => this._onTagSeen(data));
        listen('TAG_LOST', (data) => this._onTagLost(data));

        // Tracker State Machine Events
        listen('OBJECT_ADDED', (data) => {
            if (data?.trackedObject) {
                this._trackerStates.set(data.tagId, data.trackedObject.state);
            }
        });
        listen('OBJECT_UPDATED', (data) => {
            if (data?.trackedObject) {
                this._trackerStates.set(data.tagId, data.trackedObject.state);
            }
        });
        listen('OBJECT_REMOVED', (data) => {
            this._trackerStates.delete(data.tagId);
        });

        // Anchor Events
        listen('ANCHOR_CREATED', (data) => this._activeAnchors.add(data.tagId));
        listen('ANCHOR_REMOVED', (data) => this._activeAnchors.delete(data.tagId));

        // Object Loading Events
        listen('MODEL_LOADING', (data) => {
            if (data?.url) this._pendingModels.add(data.url);
        });
        listen('MODEL_LOADED', (data) => {
            if (data?.url) {
                this._pendingModels.delete(data.url);
                this._loadedModels.add(data.url);
                this._cachedModels.add(data.url);
            }
        });
        listen('MODEL_UNLOADED', (data) => {
            if (data?.url) {
                this._loadedModels.delete(data.url);
                this._cachedModels.delete(data.url);
            }
        });
    }

    /**
     * Unsubscribes all registered EventBus listeners.
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
     * Binds keyboard listener for 'D' key press to toggle visibility.
     * @private
     */
    _bindKeyboard() {
        this._onKeyDown = (e) => {
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) {
                return;
            }

            if (e.key === 'd' || e.key === 'D') {
                this.toggle();
            }
        };
        window.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * Unbinds keyboard listener.
     * @private
     */
    _unbindKeyboard() {
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown);
            this._onKeyDown = null;
        }
    }

    // ------------------------------------------------------------------ //
    //  Private — Metric Handlers & UI Renderer
    // ------------------------------------------------------------------ //

    /**
     * Updates frame timing and calculates rolling FPS.
     * @param {number} deltaTime
     * @private
     */
    _updateMetrics(deltaTime) {
        this._frameTime = deltaTime;
        this._fpsFrames++;

        const now = performance.now();
        const elapsed = now - this._lastFpsTime;
        if (elapsed >= 500) {
            this._fps = Math.round((this._fpsFrames * 1000) / elapsed);
            this._fpsFrames = 0;
            this._lastFpsTime = now;
        }

        // Age out stale tags not seen in the last 1.5 seconds
        for (const [tagId, info] of this._visibleTags) {
            if (now - info.lastSeen > 1500) {
                this._visibleTags.delete(tagId);
            }
        }
    }

    /**
     * Handles camera stream state and extracts device label and stream resolution.
     * @param {Object} data
     * @private
     */
    _onCameraStream(data) {
        this._activeCamera = data.label || `Camera ${data.deviceId?.slice(0, 8) ?? ''}`;
        if (data.stream) {
            const track = data.stream.getVideoTracks()[0];
            if (track && typeof track.getSettings === 'function') {
                const settings = track.getSettings();
                if (settings.width && settings.height) {
                    this._cameraResolution = `${settings.width}x${settings.height}`;
                }
            }
        }
    }

    /**
     * Records active tag detection/update events.
     * @param {Object} data
     * @private
     */
    _onTagSeen(data) {
        this._visibleTags.set(data.tagId, {
            confidence: data.confidence ?? null,
            lastSeen: performance.now(),
        });
    }

    /**
     * Handles tag lost events.
     * @param {Object} data
     * @private
     */
    _onTagLost(data) {
        this._visibleTags.delete(data.tagId);
    }

    /**
     * Fast direct updates to DOM text nodes.
     * @private
     */
    _renderUI() {
        if (!this._els) return;

        this._els.fps.textContent = this._fps;
        this._els.fTime.textContent = `${this._frameTime.toFixed(1)} ms`;

        // Memory Heap (if supported by browser)
        if (typeof window !== 'undefined' && window.performance && performance.memory) {
            const heapMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
            this._els.mem.textContent = `${heapMB} MB`;
        } else {
            this._els.mem.textContent = 'N/A';
        }

        this._els.cam.textContent = this._activeCamera;
        this._els.camRes.textContent = this._cameraResolution;

        if (typeof window !== 'undefined') {
            this._els.screen.textContent = `${window.innerWidth}x${window.innerHeight}`;
            this._els.dpr.textContent = window.devicePixelRatio ? window.devicePixelRatio.toFixed(1) : '1.0';
        }

        this._els.trStatus.textContent = this._trackingStatus;

        const tagIds = Array.from(this._visibleTags.keys());
        this._els.tagCount.textContent = tagIds.length;
        this._els.tagIds.textContent = tagIds.length > 0 ? `[${tagIds.join(', ')}]` : '[]';

        // Average Pose Confidence
        let avgConf = 'N/A';
        if (this._visibleTags.size > 0) {
            let sum = 0;
            let count = 0;
            for (const info of this._visibleTags.values()) {
                if (typeof info.confidence === 'number') {
                    sum += info.confidence;
                    count++;
                }
            }
            if (count > 0) {
                avgConf = (sum / count).toFixed(2);
            }
        }
        this._els.conf.textContent = avgConf;

        // Tracker State summary
        const states = Array.from(this._trackerStates.entries())
            .map(([id, state]) => `#${id}:${state}`)
            .join(' ');
        this._els.trState.textContent = states || 'IDLE';

        this._els.anchors.textContent = this._activeAnchors.size;

        this._els.loadedM.textContent = this._loadedModels.size;
        this._els.cachedM.textContent = this._cachedModels.size;
        this._els.pendingM.textContent = this._pendingModels.size;

        // WebGL Renderer Statistics
        if (this._renderer && this._renderer.info) {
            const info = this._renderer.info;
            this._els.drawCalls.textContent = info.render.calls;
            this._els.triangles.textContent = info.render.triangles;
            this._els.geometries.textContent = info.memory.geometries;
            this._els.textures.textContent = info.memory.textures;

            if (this._renderer.capabilities) {
                this._els.webglVer.textContent = this._renderer.capabilities.isWebGL2 ? 'WebGL 2.0' : 'WebGL 1.0';
            }
        }
    }
}
