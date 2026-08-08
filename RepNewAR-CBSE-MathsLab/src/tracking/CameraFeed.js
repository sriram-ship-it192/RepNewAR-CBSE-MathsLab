/**
 * CameraFeed.js - Browser Camera Input Handler
 *
 * Responsibility:
 * - Requests camera access via MediaDevices.getUserMedia().
 * - Enumerates all available video input devices.
 * - Provides a public API for switching between cameras.
 * - Handles permission denial, unsupported browsers, and hardware disconnects.
 * - Integrates with EventBus for inter-module communication.
 * - Integrates with StateManager for global state transitions.
 *
 * Public API:
 * - start(deviceId?)
 * - stop()
 * - getAvailableCameras()
 * - switchCamera(deviceId)
 * - getActiveDeviceId()
 * - getVideoElement()
 * - isRunning()
 *
 * Events emitted via EventBus:
 * - CAMERA_READY          { deviceId, label, stream }
 * - CAMERA_SWITCHED       { deviceId, label, stream }
 * - CAMERA_STOPPED        { }
 * - CAMERA_ERROR          { error, type: 'permission' | 'notfound' | 'hardware' | 'unsupported' }
 * - CAMERA_DISCONNECTED   { deviceId }
 */

/** @type {MediaTrackConstraints} Default constraints for a 720p rear-facing camera. */
const DEFAULT_CONSTRAINTS = {
    video: {
        width:  { ideal: 1280 },
        height: { ideal: 720  },
        frameRate: { ideal: 30 },
    },
    audio: false,
};

/**
 * Human-readable error types mapped from MediaStreamError names.
 */
const ERROR_TYPES = {
    NotAllowedError: 'permission',
    NotFoundError:   'notfound',
    NotReadableError:'hardware',
    OverconstrainedError: 'unsupported',
};

export class CameraFeed {

    // ------------------------------------------------------------------ //
    //  Construction
    // ------------------------------------------------------------------ //

    /**
     * @param {EventBus} eventBus  - The global pub/sub event bus.
     * @param {StateManager} stateManager - The global state manager.
     */
    constructor(eventBus, stateManager) {
        this._eventBus   = eventBus;
        this._stateMgr   = stateManager;

        /** @type {HTMLVideoElement|null} */
        this._videoEl = document.getElementById('camera-feed');

        /** @type {MediaStream|null} The current active camera stream. */
        this._stream = null;

        /** @type {string|null} The deviceId of the currently active camera. */
        this._activeDeviceId = null;

        /** @type {Array<MediaDeviceInfo>} Cached list of video input devices. */
        this._devices = [];

        /** @type {boolean} */
        this._running = false;

        // Diagnostics
        this._diagLogInterval = 30;
        this._diagFrameCount = 0;

        console.log('[DIAG] CameraFeed constructed. videoEl:', !!this._videoEl, 'id:', this._videoEl?.id || 'none');

        // Listen for external requests to start the camera (e.g. from StartScreen).
        this._eventBus.on('START_CAMERA', () => {
            this.start();
        });
    }

    // ------------------------------------------------------------------ //
    //  Public API
    // ------------------------------------------------------------------ //

    /**
     * Starts the camera stream.
     *
     * When called the first time the user is prompted for permission.
     * On subsequent calls (or after stop()) the same device is reused
     * unless a different deviceId is supplied.
     *
     * @param {string} [deviceId] - Optional explicit deviceId to use.
     * @returns {Promise<MediaStream>} The active MediaStream.
     */
    async start(deviceId) {

        console.log('[DIAG] CameraFeed.start() called. deviceId:', deviceId || '(default)', 'already running:', this._running, 'activeDeviceId:', this._activeDeviceId);

        // 1. Guard: already running the same device.
        if (this._running && this._activeDeviceId === deviceId) {
            return this._stream;
        }

        // 2. If already running a *different* device, stop it first.
        if (this._running) {
            this._teardownStream();
        }

        try {
            this._stateMgr.setState('loading', { reason: 'camera' });

            const constraints = this._buildConstraints(deviceId);
            console.log('[DIAG] CameraFeed: requesting getUserMedia with constraints:', JSON.stringify(constraints));
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[DIAG] CameraFeed: stream CREATED successfully. tracks:', stream.getVideoTracks().length);

            this._stream = stream;
            this._activeDeviceId = deviceId ?? this._resolveActiveDeviceId(stream);
            this._running = true;

            const videoTrack = stream.getVideoTracks()[0];
            const settings = videoTrack?.getSettings?.();
            console.log('[DIAG] CameraFeed: video track settings:', settings ? JSON.stringify(settings) : 'unavailable');

            // Attach to the hidden <video> element so downstream consumers
            // (e.g. the AprilTag detector) can read frames.
            if (this._videoEl) {
                this._videoEl.srcObject = stream;
                console.log('[DIAG] CameraFeed: srcObject set, before play() — readyState:', this._videoEl.readyState, 'videoWidth:', this._videoEl.videoWidth, 'videoHeight:', this._videoEl.videoHeight);
                // Auto-play is required on most mobile browsers.
                await this._videoEl.play();
                console.log('[DIAG] CameraFeed: play() resolved — readyState:', this._videoEl.readyState, 'videoWidth:', this._videoEl.videoWidth, 'videoHeight:', this._videoEl.videoHeight, 'duration:', this._videoEl.duration);
            } else {
                console.error('[DIAG] CameraFeed: videoEl is NULL — cannot attach stream!');
            }

            // Bind devicechange so we can react to USB camera removals.
            this._bindDeviceChange();

            const label = this._findDeviceLabel(this._activeDeviceId);
            console.log('[DIAG] CameraFeed: emitting CAMERA_READY. deviceId:', this._activeDeviceId, 'label:', label);
            this._eventBus.emit('CAMERA_READY', {
                deviceId: this._activeDeviceId,
                label,
                stream,
            });

            this._stateMgr.setState('active', { camera: this._activeDeviceId });
            return stream;

        } catch (err) {
            console.error('[DIAG] CameraFeed.start() FAILED:', err.name, err.message);
            this._running = false;
            const type = ERROR_TYPES[err.name] ?? 'hardware';
            this._eventBus.emit('CAMERA_ERROR', { error: err, type });
            this._stateMgr.setState('error', { reason: 'camera', type, message: err.message });
            throw err;
        }
    }

    /**
     * Stops the active camera stream and releases all hardware resources.
     */
    stop() {
        if (!this._running) return;
        this._teardownStream();
        this._eventBus.emit('CAMERA_STOPPED', {});
        this._stateMgr.setState('idle');
    }

    /**
     * Enumerates all video-input devices available on the system.
     *
     * Note: In secure contexts (HTTPS) browser labels are returned.
     * In non-secure contexts only deviceIds are available until after
     * getUserMedia() has been granted.
     *
     * @returns {Promise<Array<{deviceId: string, label: string}>>}
     */
    async getAvailableCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this._devices = devices.filter(d => d.kind === 'videoinput');
            return this._devices.map(d => ({ deviceId: d.deviceId, label: d.label }));
        } catch (err) {
            this._eventBus.emit('CAMERA_ERROR', { error: err, type: 'hardware' });
            return [];
        }
    }

    /**
     * Switches the active camera to a different device.
     *
     * Stops the current stream and starts a new one for the target device.
     * If the target is already active the call is a no-op.
     *
     * @param {string} deviceId - The deviceId of the target camera.
     * @returns {Promise<MediaStream>}
     */
    async switchCamera(deviceId) {
        if (!deviceId) {
            throw new Error('CameraFeed: switchCamera requires a deviceId.');
        }

        if (deviceId === this._activeDeviceId && this._running) {
            return this._stream;
        }

        this.stop();
        return this.start(deviceId).then(stream => {
            const label = this._findDeviceLabel(deviceId);
            this._eventBus.emit('CAMERA_SWITCHED', { deviceId, label, stream });
            return stream;
        });
    }

    /** @returns {string|null} The deviceId of the currently active camera. */
    getActiveDeviceId() {
        return this._activeDeviceId;
    }

    /** @returns {HTMLVideoElement|null} The hidden <video> DOM element. */
    getVideoElement() {
        return this._videoEl;
    }

    /** @returns {boolean} Whether a camera stream is currently active. */
    isRunning() {
        return this._running;
    }

    // ------------------------------------------------------------------ //
    //  Private helpers
    // ------------------------------------------------------------------ //

    /**
     * Builds MediaStreamConstraints for getUserMedia().
     *
     * Desktop:  Prefers a user-facing camera (webcam).
     * Mobile:   Prefers the rear (environment) camera.
     *
     * @param {string} [deviceId] - Explicit deviceId override.
     * @returns {MediaStreamConstraints}
     * @private
     */
    _buildConstraints(deviceId) {
        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const facingMode = isMobile ? 'environment' : 'user';

        if (deviceId) {
            return {
                video: { deviceId: { exact: deviceId }, ...DEFAULT_CONSTRAINTS.video },
                audio: false,
            };
        }

        return {
            video: { facingMode: { ideal: facingMode }, ...DEFAULT_CONSTRAINTS.video },
            audio: false,
        };
    }

    /**
     * Resolves the active deviceId from a MediaStream's tracks.
     *
     * @param {MediaStream} stream
     * @returns {string}
     * @private
     */
    _resolveActiveDeviceId(stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            // getSettings() returns the actual resolved deviceId.
            const settings = videoTrack.getSettings();
            if (settings.deviceId) return settings.deviceId;
        }
        return null;
    }

    /**
     * Looks up the human-readable label for a deviceId from the cached list.
     *
     * @param {string} deviceId
     * @returns {string}
     * @private
     */
    _findDeviceLabel(deviceId) {
        const device = this._devices.find(d => d.deviceId === deviceId);
        return device ? device.label : `Camera ${deviceId?.slice(0, 8) ?? 'unknown'}`;
    }

    /**
     * Stops all tracks on the current stream, clears the video element,
     * and resets internal state.
     *
     * @private
     */
    _teardownStream() {
        if (this._stream) {
            this._stream.getTracks().forEach(track => track.stop());
            this._stream = null;
        }
        if (this._videoEl) {
            this._videoEl.srcObject = null;
        }
        this._activeDeviceId = null;
        this._running = false;
    }

    /**
     * Binds the devicechange event to detect hardware removals (e.g. USB
     * camera unplugged while streaming).
     *
     * @private
     */
    _bindDeviceChange() {
        // Remove any stale listener to avoid duplicates.
        navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
        navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
    }

    /**
     * Handler for the devicechange event.
     *
     * If the currently active camera is no longer in the device list,
     * the stream is considered orphaned and the module emits
     * CAMERA_DISCONNECTED.
     *
     * @private
     */
    _onDeviceChange = async () => {
        if (!this._running || !this._activeDeviceId) return;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const stillPresent = videoDevices.some(d => d.deviceId === this._activeDeviceId);

        if (!stillPresent) {
            const lostId = this._activeDeviceId;
            this._teardownStream();
            this._eventBus.emit('CAMERA_DISCONNECTED', { deviceId: lostId });
            this._stateMgr.setState('error', { reason: 'camera_disconnect', deviceId: lostId });
        } else {
            // Refresh the cached device list so labels stay accurate.
            this._devices = videoDevices;
        }
    };
}
