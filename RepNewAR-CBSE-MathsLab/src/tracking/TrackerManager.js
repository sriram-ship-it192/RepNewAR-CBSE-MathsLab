/**
 * TrackerManager.js - Tracked Object Lifecycle Manager
 *
 * Responsibility:
 * - Receives filtered pose data from PoseFilter via EventBus.
 * - Maintains a registry of active tracked objects with full lifecycle
 *   state management: NEW → TRACKING → TEMP_LOST → LOST → REMOVED.
 * - Tracks per-object metadata: lifetime, timestamps, confidence history,
 *   frame counts, and composite object relationships.
 * - Supports composite tracked objects where a parent tag has child tags
 *   (e.g. a pizza model with removable slices), maintaining hierarchical
 *   parent-child relationships.
 * - Emits only events — no rendering, no Three.js, no lesson logic, no UI.
 *
 * Public API:
 * - register(tagId, metadata?)
 * - unregister(tagId)
 * - getTrackedObjects()
 * - getObject(tagId)
 * - update()
 * - clear()
 * - dispose()
 *
 * Events emitted via EventBus:
 * - OBJECT_ADDED     { tagId, metadata, trackedObject }
 * - OBJECT_UPDATED   { tagId, trackedObject }
 * - OBJECT_LOST      { tagId, trackedObject }
 * - OBJECT_REMOVED   { tagId }
 *
 * Events consumed via EventBus:
 * - POSE_FILTERED    Filtered pose from PoseFilter.
 * - POSE_RESET       Filter state cleared for a tag.
 */

const OBJECT_STATES = Object.freeze({
    NEW:        'NEW',
    TRACKING:   'TRACKING',
    TEMP_LOST:  'TEMP_LOST',
    LOST:       'LOST',
    REMOVED:    'REMOVED',
});

const TEMP_LOST_THRESHOLD = 1;
const LOST_THRESHOLD = 15;
const CONFIDENCE_HISTORY_SIZE = 120;

// ── Multi-tag cube tracking constants ──
const CUBE_TAG_IDS = []; // Set empty for independent 3D shape mode
const CUBE_COMPOSITE_ID = -1; // virtual tagId for the fused cube
const CUBE_HALF_SIZE = 0.05; // half of 0.1m cube

// Face offset: the cube center position in each tag's local coordinate system.
const CUBE_FACE_OFFSET = [0, 0, -CUBE_HALF_SIZE];

const CUBE_FACE_ADJ_QUATS = {
    0: { x:  0.7071068, y:  0,          z: 0, w: 0.7071068 },  // Top
    1: { x: -0.7071068, y:  0,          z: 0, w: 0.7071068 },  // Bottom
    2: { x:  0,         y:  0,          z: 0, w: 1        },  // Front
    3: { x:  0,         y: -1,          z: 0, w: 0        },  // Back
    4: { x:  0,         y:  0.7071068,  z: 0, w: 0.7071068 },  // Left
    5: { x:  0,         y: -0.7071068,  z: 0, w: 0.7071068 },  // Right
};

const FACE_NAMES = {
    0: 'top',
    1: 'bottom',
    2: 'front',
    3: 'back',
    4: 'left',
    5: 'right',
};

export class TrackerManager {

    constructor(eventBus) {
        this._eventBus = eventBus;
        this._objects = new Map();

        this._diagCounter = 0;

        // Per-frame accumulator for cube face tag estimates
        this._cubeFrameEstimates = new Map();

        this._onPoseFiltered = this._onPoseFiltered.bind(this);
        this._eventBus.on('POSE_FILTERED', this._onPoseFiltered);

        this._onPoseReset = this._onPoseReset.bind(this);
        this._eventBus.on('POSE_RESET', this._onPoseReset);

        // Listen directly to raw tag events for cube face fusion
        // (bypasses PoseFilter which strips the rotation quaternion).
        this._onTagDetected = (data) => {
            if (CUBE_TAG_IDS.includes(data.tagId)) {
                this._cubeFrameEstimates.set(data.tagId, data.pose);
                // Process immediately with don't-clear flag so multiple
                // tags detected in the same frame all contribute.
                this._processCubeComposite(false);
            }
        };
        this._onTagUpdated = (data) => {
            if (CUBE_TAG_IDS.includes(data.tagId)) {
                this._cubeFrameEstimates.set(data.tagId, data.pose);
                this._processCubeComposite(false);
            }
        };
        this._eventBus.on('TAG_DETECTED', this._onTagDetected);
        this._eventBus.on('TAG_UPDATED', this._onTagUpdated);

        console.log('[DIAG] TrackerManager: subscribed to POSE_FILTERED, POSE_RESET, TAG_DETECTED, TAG_UPDATED');
    }

    register(tagId, metadata = {}) {
        if (this._objects.has(tagId)) {
            return this._objects.get(tagId);
        }

        const trackedObject = this._createTrackedObject(tagId, metadata);
        this._objects.set(tagId, trackedObject);

        if (metadata.parentId != null && this._objects.has(metadata.parentId)) {
            const parent = this._objects.get(metadata.parentId);
            if (!parent.childTagIds.includes(tagId)) {
                parent.childTagIds.push(tagId);
            }
        }

        console.log('[DIAG] TrackerManager: Emitting OBJECT_ADDED for tag #' + tagId);
        this._eventBus.emit('OBJECT_ADDED', {
            tagId,
            metadata,
            trackedObject: this._serializeObject(trackedObject),
        });

        return trackedObject;
    }

    unregister(tagId) {
        const obj = this._objects.get(tagId);
        if (!obj || obj.state === OBJECT_STATES.REMOVED) {
            return false;
        }

        obj.state = OBJECT_STATES.REMOVED;
        const serialized = this._serializeObject(obj);
        this._objects.delete(tagId);

        this._eventBus.emit('OBJECT_REMOVED', { tagId, trackedObject: serialized });
        return true;
    }

    getTrackedObjects() {
        return Array.from(this._objects.values()).map(obj =>
            this._serializeObject(obj),
        );
    }

    getObject(tagId) {
        const obj = this._objects.get(tagId);
        if (!obj) return null;
        return this._serializeObject(obj);
    }

    update() {
        // ── 1. Process multi-tag cube fusion (clear buffer so aging works) ──
        this._processCubeComposite(true);

        // ── 2. Age all individual tracked objects (skip cube composite) ──
        for (const [tagId, obj] of this._objects) {
            if (tagId === CUBE_COMPOSITE_ID) continue; // aged by _updateCubeComposite
            if (obj.state === OBJECT_STATES.NEW) continue;

            if (obj.state === OBJECT_STATES.TRACKING) {
                obj.missedFrames++;

                if (obj.missedFrames >= TEMP_LOST_THRESHOLD) {
                    obj.state = OBJECT_STATES.TEMP_LOST;
                    this._eventBus.emit('OBJECT_LOST', {
                        tagId,
                        trackedObject: this._serializeObject(obj),
                        reason: 'temp_lost',
                    });
                }
            } else if (obj.state === OBJECT_STATES.TEMP_LOST) {
                obj.missedFrames++;

                if (obj.missedFrames >= LOST_THRESHOLD) {
                    obj.state = OBJECT_STATES.LOST;
                    this._eventBus.emit('OBJECT_LOST', {
                        tagId,
                        trackedObject: this._serializeObject(obj),
                        reason: 'lost',
                    });
                }
            } else if (obj.state === OBJECT_STATES.LOST) {
                continue;
            }
        }
    }

    // ------------------------------------------------------------------ //
    //  Private — Multi-Tag Cube Fusion
    // ------------------------------------------------------------------ //

    /**
     * Computes the unified cube pose from all visible face tags and updates
     * the cube composite tracked object.
     *
     * Called from both raw TAG_DETECTED/TAG_UPDATED handlers (with
     * shouldClear=false so multiple tags in the same frame contribute)
     * and from update() (with shouldClear=true for aging).
     *
     * @param {boolean} shouldClear  If true, clear the per-frame buffer
     *   after processing so aging logic kicks in next frame.
     * @private
     */
    _processCubeComposite(shouldClear) {
        if (this._cubeFrameEstimates.size < 2) {
            // Composite cube fusion requires at least 2 visible faces simultaneously.
            // When only 1 tag is visible, remove any active composite anchor so single markers handle their own unique 3D shapes.
            const cubeObj = this._objects.get(CUBE_COMPOSITE_ID);
            if (cubeObj) {
                this._objects.delete(CUBE_COMPOSITE_ID);
                this._eventBus.emit('OBJECT_REMOVED', { tagId: CUBE_COMPOSITE_ID });
            }
            if (shouldClear) {
                this._cubeFrameEstimates.clear();
            }
            return;
        }

        // ── Compute fused pose from all visible face tags ──
        const fusedPose = this._computeFusedCubePose();
        if (!fusedPose) return;

        if (!this._objects.has(CUBE_COMPOSITE_ID)) {
            // Register a new cube composite — appears immediately
            const visibleTags = [...this._cubeFrameEstimates.keys()];
            this._objects.set(CUBE_COMPOSITE_ID, this._createTrackedObject(CUBE_COMPOSITE_ID, {
                isCubeComposite: true,
                faceTags: visibleTags,
            }));
            const obj = this._objects.get(CUBE_COMPOSITE_ID);
            obj.state = OBJECT_STATES.TRACKING;
            obj.firstSeen = performance.now();
            obj.lastSeen = performance.now();
            obj.frameCount = 0;
            console.log('[DIAG] TrackerManager: Cube composite created with ' + visibleTags.length + ' face tag(s):', visibleTags);
            this._eventBus.emit('OBJECT_ADDED', {
                tagId: CUBE_COMPOSITE_ID,
                metadata: { isCubeComposite: true, faceTags: visibleTags },
                trackedObject: this._serializeObject(obj),
            });
        }

        // Update the cube composite object
        const obj = this._objects.get(CUBE_COMPOSITE_ID);
        obj.latestPose = fusedPose;
        obj.lastSeen = performance.now();
        obj.missedFrames = 0;
        obj.frameCount++;
        obj.state = OBJECT_STATES.TRACKING;
        obj.metadata.faceTags = [...this._cubeFrameEstimates.keys()];

        this._eventBus.emit('OBJECT_UPDATED', {
            tagId: CUBE_COMPOSITE_ID,
            trackedObject: this._serializeObject(obj),
        });

        // Only clear when called from update() — when called from
        // detection handlers (shouldClear=false) the buffer stays so
        // additional tags detected in the same frame contribute to
        // the fused pose.
        if (shouldClear) {
            this._cubeFrameEstimates.clear();
        }
    }

    /**
     * Computes the averaged cube center position and rotation from all
     * visible face tags detected this frame.
     *
     * For each tag, the cube center in camera space is:
     *   cube_pos = t_tag + R_tag * face_offset
     * Where face_offset is (0, 0, -CUBE_HALF_SIZE) in tag space.
     *
     * The cube rotation is:
     *   cube_quat = q_tag * conj(q_face_rotation)
     *
     * Positions are averaged, quaternions are summed + normalized.
     *
     * @returns {Object|null} Fused pose with translation + rotation.quaternion.
     * @private
     */
    _computeFusedCubePose() {
        const estimates = this._cubeFrameEstimates;
        if (estimates.size === 0) return null;

        const positions = [];
        const quaternions = [];

        for (const [tagId, pose] of estimates) {
            if (!pose || !pose.translation || !pose.rotation) continue;

            const qTag = pose.rotation.quaternion;
            const t = pose.translation;
            if (!qTag || t.x === undefined) continue;

            // ── Cube position: t + R * face_offset ──
            // Rotate face_offset (0, 0, -half) by tag quaternion, then add translation
            const rotated = this._rotateVectorByQuat(CUBE_FACE_OFFSET, qTag);
            positions.push({
                x: t.x + rotated.x,
                y: t.y + rotated.y,
                z: t.z + rotated.z,
            });

            // ── Cube rotation: q_tag * adj_q_face ──
            const adjQuat = CUBE_FACE_ADJ_QUATS[tagId];
            if (adjQuat) {
                quaternions.push(this._quatMultiply(qTag, adjQuat));
            } else {
                quaternions.push({ x: qTag.x, y: qTag.y, z: qTag.z, w: qTag.w });
            }
        }

        if (positions.length === 0) return null;

        // ── Average positions ──
        const avgPos = {
            x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
            y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
            z: positions.reduce((s, p) => s + p.z, 0) / positions.length,
        };

        // ── Average quaternions (sum + normalize) ──
        const qSum = quaternions.reduce((s, q) => ({
            x: s.x + q.x, y: s.y + q.y, z: s.z + q.z, w: s.w + q.w,
        }), { x: 0, y: 0, z: 0, w: 0 });
        const qLen = Math.sqrt(qSum.x * qSum.x + qSum.y * qSum.y + qSum.z * qSum.z + qSum.w * qSum.w);
        const avgQuat = qLen > 1e-10
            ? { x: qSum.x / qLen, y: qSum.y / qLen, z: qSum.z / qLen, w: qSum.w / qLen }
            : { x: 0, y: 0, z: 0, w: 1 };

        return {
            translation: avgPos,
            rotation: {
                quaternion: avgQuat,
                euler: { x: 0, y: 0, z: 0 }, // placeholder — not used by AnchorManager
                matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder
            },
            error: 0,
        };
    }

    /**
     * Rotates a 3-element vector [vx, vy, vz] by quaternion q using
     * the Rodrigues rotation formula.
     *
     * @param {number[]} v       - [vx, vy, vz]
     * @param {{x,y,z,w}} q      - Quaternion
     * @returns {{x:number, y:number, z:number}}
     * @private
     */
    _rotateVectorByQuat(v, q) {
        const vx = v[0], vy = v[1], vz = v[2];
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;

        // t = 2 * cross(q.xyz, v)
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);

        // result = v + qw * t + cross(q.xyz, t)
        return {
            x: vx + qw * tx + (qy * tz - qz * ty),
            y: vy + qw * ty + (qz * tx - qx * tz),
            z: vz + qw * tz + (qx * ty - qy * tx),
        };
    }

    /**
     * Multiplies two quaternions: result = a * b.
     *
     * @param {{x,y,z,w}} a
     * @param {{x,y,z,w}} b
     * @returns {{x:number, y:number, z:number, w:number}}
     * @private
     */
    _quatMultiply(a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        };
    }

    clear() {
        const tagIds = Array.from(this._objects.keys());
        this._objects.clear();
        for (const tagId of tagIds) {
            this._eventBus.emit('OBJECT_REMOVED', { tagId });
        }
    }

    dispose() {
        this.clear();
        this._eventBus.off('POSE_FILTERED', this._onPoseFiltered);
        this._eventBus.off('POSE_RESET', this._onPoseReset);
        this._eventBus.off('TAG_DETECTED', this._onTagDetected);
        this._eventBus.off('TAG_UPDATED', this._onTagUpdated);
    }

    _onPoseFiltered(data) {
        // Skip cube face tags — they are handled by the cube fusion logic
        // via raw TAG_DETECTED/TAG_UPDATED which include the rotation quaternion.
        if (CUBE_TAG_IDS.includes(data.tagId)) {
            if (this._diagCounter % 60 === 0) {
                console.log('[DIAG] TrackerManager: POSE_FILTERED for face tag #' + data.tagId + ' — handled by cube fusion (skipped individual).');
            }
            return;
        }

        this._diagCounter++;
        if (this._diagCounter % 60 === 0) {
            console.log('[DIAG] TrackerManager: RECEIVED POSE_FILTERED for tag #' + data.tagId + ' (event #' + this._diagCounter + ')');
        }

        const { tagId, pose, confidence, isInverted } = data;

        if (!this._objects.has(tagId)) {
            console.log('[DIAG] TrackerManager: Auto-registering tag #' + tagId);
            this.register(tagId, { isInverted });
        }

        const obj = this._objects.get(tagId);
        if (isInverted !== undefined) {
            obj.metadata.isInverted = isInverted;
        }

        obj.latestPose = pose;
        obj.lastSeen = performance.now();
        obj.missedFrames = 0;
        obj.frameCount++;

        this._pushConfidence(obj, confidence);

        if (obj.state === OBJECT_STATES.NEW) {
            obj.firstSeen = obj.lastSeen;
            obj.state = OBJECT_STATES.TRACKING;
            if (this._diagCounter % 60 === 0) {
                console.log('[DIAG] TrackerManager: Tag #' + tagId + ' transitioned NEW → TRACKING');
            }
        }

        if (obj.state === OBJECT_STATES.TEMP_LOST) {
            obj.state = OBJECT_STATES.TRACKING;
            console.log('[DIAG] TrackerManager: Tag #' + tagId + ' recovered TEMP_LOST → TRACKING');
        }

        if (this._diagCounter % 60 === 0) {
            console.log('[DIAG] TrackerManager: Emitting OBJECT_UPDATED for tag #' + tagId + ' state:', obj.state, 'frameCount:', obj.frameCount);
        }

        this._eventBus.emit('OBJECT_UPDATED', {
            tagId,
            trackedObject: this._serializeObject(obj),
        });
    }

    _onPoseReset(data) {
        const obj = this._objects.get(data.tagId);
        if (!obj) return;
        obj.missedFrames = 0;
    }

    _createTrackedObject(tagId, metadata) {
        return {
            tagId,
            state: OBJECT_STATES.NEW,
            metadata: metadata ?? null,
            latestPose: null,
            firstSeen: 0,
            lastSeen: 0,
            missedFrames: 0,
            frameCount: 0,
            confidenceHistory: [],
            parentId: metadata?.parentId ?? null,
            childTagIds: [],
        };
    }

    _pushConfidence(obj, confidence) {
        if (obj.confidenceHistory.length >= CONFIDENCE_HISTORY_SIZE) {
            obj.confidenceHistory.shift();
        }
        obj.confidenceHistory.push(confidence);
    }

    _serializeObject(obj) {
        return {
            tagId:             obj.tagId,
            state:             obj.state,
            metadata:          obj.metadata,
            latestPose:        obj.latestPose,
            firstSeen:         obj.firstSeen,
            lastSeen:          obj.lastSeen,
            missedFrames:      obj.missedFrames,
            frameCount:        obj.frameCount,
            confidenceHistory: [...obj.confidenceHistory],
            parentId:          obj.parentId,
            childTagIds:       [...obj.childTagIds],
        };
    }
}
