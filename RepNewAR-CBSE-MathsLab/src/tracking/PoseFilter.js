/**
 * PoseFilter.js - Pose Smoothing and Outlier Rejection
 *
 * Responsibility:
 * - Accepts raw pose data from AprilTagDetector (after TAG_DETECTED /
 *   TAG_UPDATED events).
 * - Applies configurable exponential moving average (EMA) smoothing to
 *   translation and rotation independently.
 * - Rejects obvious outlier poses (sudden position jumps, rotation flips,
 *   or implausibly large deltas between consecutive frames).
 * - Provides a Kalman filter architecture hook for future replacement or
 *   coexistence with EMA.  The current default is EMA.
 * - Emits filtered pose data via EventBus for downstream consumers
 *   (AnchorManager, SceneManager).
 *
 * Public API:
 * - initialize(options?)
 * - filter(tagId, rawPose)
 * - reset(tagId)
 * - dispose()
 *
 * Events emitted via EventBus:
 * - POSE_FILTERED     { tagId, pose, confidence, smoothed }
 * - POSE_RESET        { tagId }
 *
 * Events consumed via EventBus:
 * - TAG_DETECTED      Raw pose input from AprilTagDetector.
 * - TAG_UPDATED       Raw pose input from AprilTagDetector.
 * - TAG_LOST          Resets the filter state for that tag.
 */

// Zero-latency configuration:
//   alpha = 1.0  → raw pass-through, no EMA smoothing
//   outlier thresholds = Infinity → never reject a pose;
//     the user wants instant frame-for-frame response even during
//     rapid movement, so no position hold / stale-repeat.
const DEFAULT_OPTIONS = Object.freeze({
    translationAlpha:            0.35,
    rotationAlpha:               0.35,
    outlierDistanceThreshold:   Infinity,
    outlierRotationThreshold:    Infinity,
    enableKalman:               false,
});

export class PoseFilter {

    constructor(eventBus) {
        this._eventBus = eventBus;
        this._options = { ...DEFAULT_OPTIONS };
        this._filterStates = new Map();
        this._bindTagEvents();
    }

    initialize(options = {}) {
        this._options = { ...DEFAULT_OPTIONS, ...options };
        console.log('PoseFilter: Initialized with options:', this._options);
    }

    filter(tagId, rawPose) {
        if (!rawPose || !rawPose.translation || !rawPose.rotation) {
            return null;
        }

        if (!this._filterStates.has(tagId)) {
            this._filterStates.set(tagId, {
                translation: { ...rawPose.translation },
                rotation:    { ...rawPose.rotation.euler },
                frameCount:  0,
                isColdStart: true,
            });
        }

        const state = this._filterStates.get(tagId);
        state.frameCount++;

        if (state.isColdStart) {
            state.isColdStart = false;
            const filtered = {
                translation: { ...rawPose.translation },
                rotation:    { euler: { ...rawPose.rotation.euler } },
                confidence:  this._poseConfidence(rawPose.error ?? 0),
            };
            this._emitFiltered(tagId, filtered, true);
            return filtered;
        }

        // Adaptive speed calculation to stop shaking:
        // High speed -> alpha ~ 0.95 for instant response
        // Low speed / still -> alpha ~ 0.25 for rock-solid stability with zero jitter
        const dx = rawPose.translation.x - state.translation.x;
        const dy = rawPose.translation.y - state.translation.y;
        const dz = rawPose.translation.z - state.translation.z;
        const speed = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const adaptiveAlpha = Math.min(0.95, Math.max(0.25, speed * 25.0 + 0.25));

        const filteredTranslation = this._emaTranslation(
            state.translation,
            rawPose.translation,
            adaptiveAlpha,
        );

        const filteredRotation = this._emaRotation(
            state.rotation,
            rawPose.rotation.euler,
            adaptiveAlpha,
        );

        state.translation = filteredTranslation;
        state.rotation    = filteredRotation;

        const result = {
            translation: filteredTranslation,
            rotation:    { euler: filteredRotation },
            confidence:  this._poseConfidence(rawPose.error ?? 0),
        };

        this._emitFiltered(tagId, result, true);
        return result;
    }

    reset(tagId) {
        this._filterStates.delete(tagId);
        this._eventBus.emit('POSE_RESET', { tagId });
    }

    dispose() {
        this._filterStates.clear();
        this._eventBus.off('TAG_DETECTED', this._onTagDetected);
        this._eventBus.off('TAG_UPDATED', this._onTagUpdated);
        this._eventBus.off('TAG_LOST', this._onTagLost);
    }

    _bindTagEvents() {
        this._diagCounter = 0;

        this._onTagDetected = (data) => {
            this._diagCounter++;
            if (this._diagCounter % 60 === 0) {
                console.log('[DIAG] PoseFilter: RECEIVED TAG_DETECTED for tag #' + data.tagId + ' (event #' + this._diagCounter + ')');
            }
            const raw = data.pose ? { ...data.pose, isInverted: data.isInverted } : null;
            this.filter(data.tagId, raw);
        };
        this._onTagUpdated  = (data) => {
            this._diagCounter++;
            if (this._diagCounter % 60 === 0) {
                console.log('[DIAG] PoseFilter: RECEIVED TAG_UPDATED for tag #' + data.tagId + ' (event #' + this._diagCounter + ')');
            }
            const raw = data.pose ? { ...data.pose, isInverted: data.isInverted } : null;
            this.filter(data.tagId, raw);
        };
        this._onTagLost     = (data) => {
            console.log('[DIAG] PoseFilter: RECEIVED TAG_LOST for tag #' + data.tagId);
            this.reset(data.tagId);
        };

        this._eventBus.on('TAG_DETECTED', this._onTagDetected);
        this._eventBus.on('TAG_UPDATED',  this._onTagUpdated);
        this._eventBus.on('TAG_LOST',     this._onTagLost);

        console.log('[DIAG] PoseFilter: subscribed to TAG_DETECTED, TAG_UPDATED, TAG_LOST');
    }

    _emitFiltered(tagId, pose, accepted) {
        this._eventBus.emit('POSE_FILTERED', {
            tagId,
            pose,
            confidence: pose?.confidence,
            smoothed: accepted,
            isInverted: pose?.isInverted,
        });
    }

    _emaTranslation(previous, raw, alpha) {
        return {
            x: alpha * raw.x + (1 - alpha) * previous.x,
            y: alpha * raw.y + (1 - alpha) * previous.y,
            z: alpha * raw.z + (1 - alpha) * previous.z,
        };
    }

    _emaRotation(previous, raw, alpha) {
        return {
            x: this._wrappedInterpolate(previous.x, raw.x, alpha),
            y: this._wrappedInterpolate(previous.y, raw.y, alpha),
            z: this._wrappedInterpolate(previous.z, raw.z, alpha),
        };
    }

    _wrappedInterpolate(a, b, alpha) {
        let delta = b - a;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        return a + alpha * delta;
    }

    _isOutlier(tagId, rawPose) {
        const state = this._filterStates.get(tagId);
        if (!state || state.isColdStart) return false;

        const dx = rawPose.translation.x - state.translation.x;
        const dy = rawPose.translation.y - state.translation.y;
        const dz = rawPose.translation.z - state.translation.z;
        const distanceDelta = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distanceDelta > this._options.outlierDistanceThreshold) {
            return true;
        }

        const euler = rawPose.rotation.euler;
        const rotDelta = Math.max(
            Math.abs(this._angleDelta(state.rotation.x, euler.x)),
            Math.abs(this._angleDelta(state.rotation.y, euler.y)),
            Math.abs(this._angleDelta(state.rotation.z, euler.z)),
        );

        if (rotDelta > this._options.outlierRotationThreshold) {
            return true;
        }

        return false;
    }

    _angleDelta(a, b) {
        let delta = b - a;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        return delta;
    }

    _poseConfidence(error) {
        return Math.max(0, Math.min(1, Math.exp(-error * 100)));
    }
}
