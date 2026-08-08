/**
 * AprilTagDetector.js — AprilTag Detection via WebAssembly
 *
 * Downloads the official arenaxr/apriltag-js-standalone WASM module and
 * delegates all detection to an ApriltagWrapper instance that replicates
 * the exact API of the official Apriltag class.
 *
 * Events emitted via EventBus:
 *   TAG_DETECTED     { tagId, pose, corners, confidence }
 *   TAG_UPDATED      { tagId, pose, corners, confidence, age }
 *   TAG_LOST         { tagId }
 *   TRACKING_STARTED { }
 *   TRACKING_STOPPED { }
 *   TRACKING_ERROR   { error }
 *
 * Detection lifecycle:
 *   initialize(cameraParams, options?) — load WASM, configure detector
 *   start()                            — begin RAF detection loop
 *   stop()                             — stop loop, emit TAG_LOST for all tags
 *   detectFrame()                      — single-frame manual detection
 *   dispose()                          — release all resources
 *   setTagSize(tagId, size)            — set physical tag size for pose
 */

import { ApriltagWrapper } from './ApriltagWrapper.js';

// --------------------------------------------------------------------------- //
//  Constants
// --------------------------------------------------------------------------- //

const WASM_JS_URL =
    'https://cdn.jsdelivr.net/gh/arenaxr/apriltag-js-standalone@master/html/apriltag_wasm.js';

const WASM_WASM_URL =
    'https://cdn.jsdelivr.net/gh/arenaxr/apriltag-js-standalone@master/html/apriltag_wasm.wasm';

const DETECTION_WIDTH  = 640;
const DETECTION_HEIGHT = 480;

// Faster loss recovery: after 2 missed frames a tag is declared lost
// so the next detection triggers a clean TAG_DETECTED (not TAG_UPDATED
// with stale state).  Combined with PoseFilter outlier rejection being
// disabled, this gives the most responsive re-entry behaviour.
const LOSS_THRESHOLD = 2;

// --------------------------------------------------------------------------- //
//  Implementation
// --------------------------------------------------------------------------- //

export class AprilTagDetector {

    constructor(eventBus, stateManager, videoElement) {
        this._eventBus  = eventBus;
        this._stateMgr  = stateManager;
        this._videoEl   = videoElement;

        // ApriltagWrapper instance (created during _loadWasmModule)
        this._wrapper = null;

        this._initialized = false;
        this._running     = false;
        this._rafId       = null;
        this._cameraParams = null;

        // Offscreen canvas for frame extraction
        this._offscreenCanvas = document.createElement('canvas');
        this._offscreenCanvas.width  = DETECTION_WIDTH;
        this._offscreenCanvas.height = DETECTION_HEIGHT;
        this._offscreenCtx = this._offscreenCanvas.getContext('2d', {
            willReadFrequently: true,
        });

        // Tag tracking: tagId → { lastSeen, age, frameCount }
        this._knownTags = new Map();

        // Diagnostics
        this._diagFrameCount = 0;
        this._diagLastLogFrame = 0;
        this._diagLogInterval = 60; // log summary every ~1 second
        this._startupLogged = false;
    }

    // ------------------------------------------------------------------ //
    //  Public API
    // ------------------------------------------------------------------ //

    /**
     * Loads the WASM module and configures the detector.
     * @param {Object} cameraParams  Camera intrinsics { fx, fy, cx, cy }.
     * @param {Object} [options]     Optional overrides: maxDetections, returnPose, etc.
     */
    async initialize(cameraParams, options = {}) {
        if (this._initialized) {
            console.warn('AprilTagDetector: Already initialized. Ignoring.');
            return;
        }

        this._cameraParams = cameraParams;

        try {
            this._stateMgr.setState('loading', { reason: 'detector' });

            // ── Load the WASM module script from CDN ──
            console.log('AprilTagDetector: Loading WASM module from', WASM_JS_URL);
            await this._loadWasmModule();

            // ── Create and initialize the ApriltagWrapper with tag25h9 family ──
            this._wrapper = new ApriltagWrapper();
            await this._wrapper.initialize('tag36h11');

            // ── Set physical tag sizes for 10 test shape tags ──
            const KNOWN_TAG_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 42, 99];
            for (const tagId of KNOWN_TAG_IDS) {
                this._wrapper.set_tag_size(tagId, 0.1); // 10cm physical tag
            }

            // ── Set camera info for pose estimation ──
            // Scale parameters to match the 640×480 offscreen detection buffer size
            const videoW = (this._videoEl && this._videoEl.videoWidth) ? this._videoEl.videoWidth : 1280;
            const videoH = (this._videoEl && this._videoEl.videoHeight) ? this._videoEl.videoHeight : 720;
            const scaleX = DETECTION_WIDTH / videoW;
            const scaleY = DETECTION_HEIGHT / videoH;

            const detFx = cameraParams.fx * scaleX;
            const detFy = cameraParams.fy * scaleY;
            const detCx = DETECTION_WIDTH / 2;  // 320
            const detCy = DETECTION_HEIGHT / 2; // 240

            this._wrapper.set_camera_info(
                detFx,
                detFy,
                detCx,
                detCy
            );

            // ── Apply any option overrides ──
            if (options.maxDetections !== undefined) {
                this._wrapper.set_max_detections(options.maxDetections);
            }

            this._initialized = true;

            // ── Startup diagnostics (ONCE) ──
            const activeFamily = this._wrapper.getActiveFamily();
            const hasTag25h9 = activeFamily.includes('tag25h9');
            const hasTag36h11 = activeFamily.includes('tag36h11');
            console.log('%c===== APRILTAG STARTUP =====', 'font-weight:bold');
            console.log('%c✓ WASM Module script loaded', 'color:green');
            console.log('%c✓ ApriltagWrapper Instance Created', 'color:green');
            console.log('%c✓ Detector Initialized — active families: ' + activeFamily, 'color:' + (hasTag25h9 ? 'green' : '#ffa500'));
            if (hasTag25h9 && hasTag36h11) {
                console.log('%c✓ Both tag25h9 and tag36h11 markers are supported.', 'color:green');
            } else if (hasTag25h9) {
                console.log('%c✓ tag25h9 markers are supported.', 'color:green');
            } else if (hasTag36h11) {
                console.log('%c✓ tag36h11 markers are supported.', 'color:green');
                console.log('%c  ⚠ tag25h9 could not be added dynamically. The WASM only has tag36h11.', 'color:#ffa500');
                console.log('%c  ⚠ To use tag25h9 markers, compile a WASM with tag25h9 support.', 'color:#ffa500');
            }
            console.log('%c✓ Tag sizes set for face tags 0-5 (0.1m)', 'color:green');
            console.log('%c✓ Camera Parameters Set: fx=' + cameraParams.fx + ' fy=' + cameraParams.fy + ' cx=' + cameraParams.cx + ' cy=' + cameraParams.cy, 'color:green');
            console.log('%c✓ Image Buffer Allocated (640×480)', 'color:green');
            console.log('%c===========================', 'font-weight:bold');

            this._startupLogged = true;

        } catch (err) {
            this._initialized = false;
            this._eventBus.emit('TRACKING_ERROR', { error: err });
            this._stateMgr.setState('error', { reason: 'detector_init', message: err.message });
            throw err;
        }
    }

    /** Starts the RAF-based detection loop. */
    start() {
        if (!this._initialized) {
            throw new Error('AprilTagDetector: Must call initialize() before start().');
        }
        if (this._running) return;

        this._running = true;
        this._knownTags.clear();
        this._eventBus.emit('TRACKING_STARTED', {});
        this._stateMgr.setState('active', { reason: 'tracking' });

        this._loop();
    }

    /** Stops the detection loop. Emits TAG_LOST for all known tags. */
    stop() {
        if (!this._running) return;

        this._running = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        for (const tagId of this._knownTags.keys()) {
            this._eventBus.emit('TAG_LOST', { tagId });
        }
        this._knownTags.clear();

        this._eventBus.emit('TRACKING_STOPPED', {});
        this._stateMgr.setState('idle');
    }

    /**
     * Manually triggers a single-frame detection pass.
     * @returns {Object[]} Array of detections.
     */
    detectFrame() {
        if (!this._running || !this._initialized) return [];
        const detections = this._runDetection();
        this._processDetections(detections);
        return detections;
    }

    /** Releases all resources. */
    dispose() {
        this.stop();
        if (this._wrapper) {
            this._wrapper.destroy();
            this._wrapper = null;
        }
        this._initialized = false;
        this._cameraParams = null;
        this._offscreenCanvas = null;
        this._offscreenCtx = null;
    }

    /**
     * Sets the physical size (in metres) for a specific tag ID.
     * @param {number} tagId
     * @param {number} size   Size in metres.
     */
    setTagSize(tagId, size) {
        if (!this._initialized) {
            throw new Error('AprilTagDetector: Must call initialize() before setTagSize().');
        }
        this._wrapper.set_tag_size(tagId, size);
    }

    // ------------------------------------------------------------------ //
    //  Private — WASM Loading
    // ------------------------------------------------------------------ //

    /**
     * Loads the apriltag_wasm.js script from CDN into the page via a <script> tag.
     * Waits for the script to load and for window.AprilTagWasm to become available.
     */
    _loadWasmModule() {
        return new Promise((resolve, reject) => {
            // Already loaded?
            if (typeof window.AprilTagWasm === 'function') {
                resolve();
                return;
            }

            // Set the .wasm path so the Emscripten module knows where to fetch it
            window.apriltag_wasm_path = WASM_WASM_URL;

            // Prevent duplicate script tags
            if (document.getElementById('apriltag-wasm-script')) {
                // Script tag exists but window.AprilTagWasm isn't ready yet — wait for it
                const check = () => {
                    if (typeof window.AprilTagWasm === 'function') {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
                return;
            }

            const script = document.createElement('script');
            script.id = 'apriltag-wasm-script';
            script.src = WASM_JS_URL;

            script.onerror = () => {
                reject(new Error('AprilTagDetector: Failed to load WASM script from CDN: ' + WASM_JS_URL));
            };

            script.onload = () => {
                // The script may load before AprilTagWasm is fully defined
                const check = () => {
                    if (typeof window.AprilTagWasm === 'function') {
                        resolve();
                    } else {
                        setTimeout(check, 50);
                    }
                };
                check();
            };

            document.head.appendChild(script);
        });
    }

    // ------------------------------------------------------------------ //
    //  Private — Detection Loop
    // ------------------------------------------------------------------ //

    _loop() {
        if (!this._running) return;

        this._rafId = requestAnimationFrame(() => {
            this._diagFrameCount++;

            const videoReady = this._videoEl && this._videoEl.readyState >= 2;

            if (!videoReady) {
                if (this._shouldLog()) {
                    console.log('[DIAG] Frame ' + this._diagFrameCount + ': video not ready (readyState=' + this._videoEl?.readyState + ')');
                }
                this._loop();
                return;
            }

            const detections = this._runDetection();
            this._processDetections(detections);

            this._loop();
        });
    }

    /**
     * Extracts the current video frame, converts to grayscale, and runs
     * the WASM detector via ApriltagWrapper.
     * @returns {Object[]}
     */
    _runDetection() {
        if (!this._wrapper || !this._wrapper.isReady()) {
            if (this._shouldLog()) {
                console.log('[DIAG] _runDetection: wrapper not ready.');
            }
            return [];
        }

        const ctx = this._offscreenCtx;
        if (!ctx) {
            if (this._shouldLog()) {
                console.log('[DIAG] _runDetection: offscreen context null.');
            }
            return [];
        }

        // Draw video frame to offscreen canvas
        try {
            ctx.drawImage(this._videoEl, 0, 0, DETECTION_WIDTH, DETECTION_HEIGHT);
        } catch (drawErr) {
            if (this._shouldLog()) {
                console.log('[DIAG] _runDetection: drawImage failed:', drawErr.message);
            }
            return [];
        }

        // Get RGBA pixel data
        let imageData;
        try {
            imageData = ctx.getImageData(0, 0, DETECTION_WIDTH, DETECTION_HEIGHT);
        } catch (getErr) {
            if (this._shouldLog()) {
                console.log('[DIAG] _runDetection: getImageData FAILED — canvas tainted:', getErr.message);
            }
            return [];
        }

        const rgba = imageData.data;
        if (!rgba || rgba.length === 0) {
            if (this._shouldLog()) console.log('[DIAG] _runDetection: empty pixel data.');
            return [];
        }

        // Convert RGBA → grayscale
        const grayscale = new Uint8Array(DETECTION_WIDTH * DETECTION_HEIGHT);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
            grayscale[j] = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
        }

        // ── Run detection via ApriltagWrapper.detect() ──
        let detections;
        try {
            detections = this._wrapper.detect(grayscale, DETECTION_WIDTH, DETECTION_HEIGHT);
        } catch (detectErr) {
            if (this._shouldLog()) {
                console.error('[DIAG] _runDetection: wrapper.detect() threw:', detectErr.message);
            }
            this._eventBus.emit('TRACKING_ERROR', { error: detectErr });
            return [];
        }

        // ── Per-second diagnostics ──
        if (this._shouldLog()) {
            const count = Array.isArray(detections) ? detections.length : 0;
            const ids = count > 0
                ? detections.map(d => d.id).join(', ')
                : 'none';

            console.log('[DIAG] Frame ' + this._diagFrameCount + ':');
            console.log('[DIAG]   Image Size: ' + DETECTION_WIDTH + '×' + DETECTION_HEIGHT);
            console.log('[DIAG]   Detection Count: ' + count);

            if (count > 0) {
                console.log('[DIAG]   Tag IDs: ' + ids);
                detections.slice(0, 3).forEach((d, i) => {
                    console.log('[DIAG]     [' + i + '] id=' + d.id +
                        ' center=(' + (d.center?.x || '?') + ',' + (d.center?.y || '?') + ')' +
                        ' pose=' + (d.pose ? 'yes (error=' + d.pose.e.toFixed(6) + ')' : 'no'));
                });
            } else {
                // Explain why detection count is zero
                const fam = this._wrapper?.getActiveFamily() || 'tag36h11';
                console.log('[DIAG]   WHY: No tags visible in frame. Check:');
                console.log('[DIAG]         (1) Is an AprilTag held up to the camera?');
                console.log('[DIAG]         (2) Is the tag family correct? Active family(s): ' + fam);
                console.log('[DIAG]         (3) Is the tag well-lit and in focus?');
                console.log('[DIAG]         (4) Is the tag large enough in the frame (>80px)?');
            }
        }

        return detections || [];
    }

    /** Returns true once per ~second for throttled logging. */
    _shouldLog() {
        if (this._diagFrameCount - this._diagLastLogFrame >= this._diagLogInterval) {
            this._diagLastLogFrame = this._diagFrameCount;
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ //
    //  Private — Detection Processing & Lifecycle
    // ------------------------------------------------------------------ //

    /**
     * Processes raw detections from the WASM detector and emits EventBus events.
     * @param {Object[]} detections
     */
    _processDetections(detections) {
        const logThisFrame = this._shouldLog();

        if (!detections || detections.length === 0) {
            if (logThisFrame && this._knownTags.size > 0) {
                console.log('[DIAG] _processDetections: 0 detections, ' +
                    this._knownTags.size + ' known tags aging out.');
            }
            this._incrementAllAges();
            this._checkLostTags();
            return;
        }

        const currentFrameIds = new Set();

        for (const detection of detections) {
            const tagId = detection.id;
            currentFrameIds.add(tagId);

            const confidence = detection.pose
                ? Math.exp(-detection.pose.e * 100)
                : null;

            const normalizedPose = this._normalizePose(detection.pose);

            const corners = detection.corners;
            const center = detection.center;
            const isInverted = !!(corners && center && corners[0] && corners[0].y > center.y);

            const eventData = {
                tagId,
                pose: normalizedPose,
                corners,
                center,
                confidence,
                isInverted,
            };

            if (this._knownTags.has(tagId)) {
                const existing = this._knownTags.get(tagId);
                existing.lastSeen = performance.now();
                existing.age = 0;
                existing.frameCount++;
                eventData.age = existing.frameCount;
                this._eventBus.emit('TAG_UPDATED', eventData);
            } else {
                this._knownTags.set(tagId, {
                    lastSeen: performance.now(),
                    age: 0,
                    frameCount: 0,
                });
                eventData.age = 0;
                this._eventBus.emit('TAG_DETECTED', eventData);
            }
        }

        this._incrementAllAges(currentFrameIds);
        this._checkLostTags();
    }

    _incrementAllAges(currentFrameIds = null) {
        for (const [tagId, info] of this._knownTags) {
            if (!currentFrameIds || !currentFrameIds.has(tagId)) {
                info.age++;
            }
        }
    }

    _checkLostTags() {
        const lostTags = [];
        for (const [tagId, info] of this._knownTags) {
            if (info.age >= LOSS_THRESHOLD) {
                lostTags.push(tagId);
            }
        }
        for (const tagId of lostTags) {
            this._knownTags.delete(tagId);
            this._eventBus.emit('TAG_LOST', { tagId });
        }
    }

    // ------------------------------------------------------------------ //
    //  Private — Pose Normalization
    // ------------------------------------------------------------------ //

    _normalizePose(pose) {
        if (!pose) return null;
        const { R, t, e } = pose;
        return {
            translation: { x: t[0], y: t[1], z: t[2] },
            rotation: {
                matrix: R,
                euler: this._rotationMatrixToEuler(R),
                quaternion: this._rotationMatrixToQuaternion(R),
            },
            error: e,
        };
    }

    _rotationMatrixToEuler(R) {
        if (!R || R.length === 0) return { x: 0, y: 0, z: 0 };

        let m00, m01, m02, m10, m11, m12, m20, m21, m22;

        if (Array.isArray(R[0])) {
            // 2D array [[c0r0, c0r1, c0r2], [c1r0, ...], [c2r0, ...]]
            m00 = R[0][0]; m01 = R[1][0]; m02 = R[2][0];
            m10 = R[0][1]; m11 = R[1][1]; m12 = R[2][1];
            m20 = R[0][2]; m21 = R[1][2]; m22 = R[2][2];
        } else {
            // 1D flat array [r00, r01, r02, r10, r11, r12, r20, r21, r22]
            m00 = R[0]; m01 = R[1]; m02 = R[2];
            m10 = R[3]; m11 = R[4]; m12 = R[5];
            m20 = R[6]; m21 = R[7]; m22 = R[8];
        }

        const sy = Math.sqrt(m00 * m00 + m10 * m10);
        const singular = sy < 1e-6;

        let x, y, z;
        if (!singular) {
            x = Math.atan2(m21, m22);
            y = Math.atan2(-m20, sy);
            z = Math.atan2(m10, m00);
        } else {
            x = Math.atan2(-m12, m11);
            y = Math.atan2(-m20, sy);
            z = 0;
        }

        return {
            x: Number.isNaN(x) ? 0 : x,
            y: Number.isNaN(y) ? 0 : y,
            z: Number.isNaN(z) ? 0 : z,
        };
    }

    /**
     * Converts a 3x3 rotation matrix to a quaternion {x, y, z, w}.
     * Uses the standard algebraic method for maximum numerical stability.
     *
     * @param {number[]|number[][]} R - 9-element flat array or 3x3 nested array.
     * @returns {{x:number, y:number, z:number, w:number}}
     * @private
     */
    _rotationMatrixToQuaternion(R) {
        if (!R || R.length === 0) return { x: 0, y: 0, z: 0, w: 1 };

        let m00, m01, m02, m10, m11, m12, m20, m21, m22;

        if (Array.isArray(R[0])) {
            // 2D array [[c0r0, c0r1, c0r2], [c1r0, ...], [c2r0, ...]]
            m00 = R[0][0]; m01 = R[1][0]; m02 = R[2][0];
            m10 = R[0][1]; m11 = R[1][1]; m12 = R[2][1];
            m20 = R[0][2]; m21 = R[1][2]; m22 = R[2][2];
        } else {
            // 1D flat array [r00, r01, r02, r10, r11, r12, r20, r21, r22]
            m00 = R[0]; m01 = R[1]; m02 = R[2];
            m10 = R[3]; m11 = R[4]; m12 = R[5];
            m20 = R[6]; m21 = R[7]; m22 = R[8];
        }

        const trace = m00 + m11 + m22;
        let x, y, z, w;

        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            w = 0.25 / s;
            x = (m21 - m12) * s;
            y = (m02 - m20) * s;
            z = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            w = (m21 - m12) / s;
            x = 0.25 * s;
            y = (m01 + m10) / s;
            z = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            w = (m02 - m20) / s;
            x = (m01 + m10) / s;
            y = 0.25 * s;
            z = (m12 + m21) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            w = (m10 - m01) / s;
            x = (m02 + m20) / s;
            y = (m12 + m21) / s;
            z = 0.25 * s;
        }

        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            z: Number.isFinite(z) ? z : 0,
            w: Number.isFinite(w) ? w : 1,
        };
    }
}
