/**
 * AnchorManager.js - Three.js Object3D Anchor Bridge
 *
 * Responsibility:
 * - Listens to TrackerManager object lifecycle events (OBJECT_ADDED,
 *   OBJECT_UPDATED, OBJECT_LOST, OBJECT_REMOVED).
 * - Creates one THREE.Object3D anchor per tracked object and adds it to
 *   the Three.js scene.
 * - Maintains a strict one-to-one mapping: tagId ↔ Object3D anchor.
 * - Supports parent-child anchor hierarchy for composite objects.  When
 *   a tag is registered with a parentId, its anchor is reparented under
 *   the parent anchor so relative transforms are preserved automatically
 *   by Three.js's scene graph.
 * - Updates anchor transforms (position + rotation) from filtered poses
 *   received via OBJECT_UPDATED events.
 * - Handles object addition and removal: anchors are created on
 *   OBJECT_ADDED and removed from the scene on OBJECT_REMOVED.
 * - Removes orphan anchors automatically: if a parent anchor is removed
 *   while children still exist, children are re-attached to the scene
 *   root rather than silently disappearing.
 * - Emits anchor lifecycle events for downstream consumers.
 *
 * Public API:
 * - initialize(scene)
 * - getAnchor(tagId)
 * - getAllAnchors()
 * - removeAnchor(tagId)
 * - clear()
 * - dispose()
 *
 * Events emitted via EventBus:
 * - ANCHOR_CREATED     { tagId, anchor, parentId }
 * - ANCHOR_UPDATED     { tagId, anchor }
 * - ANCHOR_REMOVED     { tagId }
 *
 * Events consumed via EventBus:
 * - OBJECT_ADDED       From TrackerManager — creates anchor.
 * - OBJECT_UPDATED     From TrackerManager — updates transform.
 * - OBJECT_LOST        From TrackerManager — no action (anchor stays
 *                      at last known pose so 3D models don't flicker).
 * - OBJECT_REMOVED     From TrackerManager — removes anchor.
 *
 * Dependencies:
 * - three (v0.170+)
 *
 * NOTE: This module does NOT load models, render models, implement
 * lesson logic, implement animations, or implement formulas.
 * It provides empty Object3D anchors only — model attachment is the
 * responsibility of ObjectLoader or lesson plugins.
 */

import * as THREE from 'three';

// --------------------------------------------------------------------------- //
//  Types (JSDoc for IDE / linter support)
// --------------------------------------------------------------------------- //

/**
 * @typedef {Object} AnchorRecord
 * @property {THREE.Object3D} anchor   - The Three.js anchor object.
 * @property {number}         tagId    - The AprilTag ID.
 * @property {number|null}    parentId - Parent tag ID (null if root).
 */

// --------------------------------------------------------------------------- //
//  Implementation
// --------------------------------------------------------------------------- //

export class AnchorManager {

    // ------------------------------------------------------------------ //
    //  Construction
    // ------------------------------------------------------------------ //

    /**
     * @param {EventBus} eventBus - The global pub/sub event bus.
     */
    constructor(eventBus) {
        this._eventBus = eventBus;

        this._diagCounter = 0;

        /** @type {THREE.Scene|null} */
        this._scene = null;

        /** @type {Map<number, AnchorRecord>} */
        this._anchors = new Map();

        // Bind and subscribe to TrackerManager events.
        this._onObjectAdded   = this._onObjectAdded.bind(this);
        this._onObjectUpdated = this._onObjectUpdated.bind(this);
        this._onObjectLost    = this._onObjectLost.bind(this);
        this._onObjectRemoved = this._onObjectRemoved.bind(this);

        this._eventBus.on('OBJECT_ADDED',   this._onObjectAdded);
        this._eventBus.on('OBJECT_UPDATED', this._onObjectUpdated);
        this._eventBus.on('OBJECT_LOST',    this._onObjectLost);
        this._eventBus.on('OBJECT_REMOVED', this._onObjectRemoved);

        console.log('[DIAG] AnchorManager: subscribed to OBJECT_ADDED, OBJECT_UPDATED, OBJECT_LOST, OBJECT_REMOVED');
    }

    // ------------------------------------------------------------------ //
    //  Public API
    // ------------------------------------------------------------------ //

    /**
     * Initializes the AnchorManager with a reference to the Three.js scene.
     *
     * This is called after SceneManager emits SCENE_READY.  The AnchorManager
     * stores the scene reference so it can add/remove Object3D anchors.
     *
     * @param {THREE.Scene} scene - The canonical Three.js scene.
     */
    initialize(scene) {
        if (!scene) {
            throw new Error('AnchorManager: A THREE.Scene is required.');
        }
        this._scene = scene;
        console.log('AnchorManager: Initialized with scene.');
    }

    /**
     * Returns the Object3D anchor for a specific tag ID.
     *
     * @param {number} tagId - The AprilTag ID.
     * @returns {THREE.Object3D|null} The anchor, or null if not found.
     */
    getAnchor(tagId) {
        const record = this._anchors.get(tagId);
        return record ? record.anchor : null;
    }

    /**
     * Returns all active anchors as an array of AnchorRecord objects.
     *
     * @returns {Array<{tagId: number, anchor: THREE.Object3D, parentId: number|null}>}
     */
    getAllAnchors() {
        return Array.from(this._anchors.values()).map(r => ({
            tagId:    r.tagId,
            anchor:   r.anchor,
            parentId: r.parentId,
        }));
    }

    /**
     * Removes a single anchor from the scene and the registry.
     *
     * If the anchor has children (composite object parent), the children
     * are re-attached to the scene root to prevent them from becoming
     * orphaned and invisible.
     *
     * @param {number} tagId - The AprilTag ID whose anchor to remove.
     * @returns {boolean} True if the anchor was found and removed.
     */
    removeAnchor(tagId) {
        const record = this._anchors.get(tagId);
        if (!record) return false;

        const { anchor, parentId } = record;

        // ── Orphan Prevention ──
        // If this anchor is a parent, re-parent its children to the scene
        // root so they remain visible rather than silently disappearing.
        const children = this._findChildren(tagId);
        for (const childRecord of children) {
            this._scene?.add(childRecord.anchor);
            childRecord.parentId = null;
        }

        // Remove from scene.
        if (this._scene && anchor.parent) {
            anchor.parent.remove(anchor);
        }

        this._anchors.delete(tagId);

        // If this was a child of another anchor, update the parent's
        // child list.
        if (parentId != null) {
            const parentRecord = this._anchors.get(parentId);
            if (parentRecord) {
                // The parent's childTagIds is managed by TrackerManager,
                // but we ensure our local anchor hierarchy is consistent.
            }
        }

        this._eventBus.emit('ANCHOR_REMOVED', { tagId });
        return true;
    }

    /**
     * Removes all anchors from the scene and clears the registry.
     *
     * Unlike removeAnchor(), this does NOT re-parent children — the
     * caller is expected to handle scene cleanup at a higher level
     * (e.g. lesson change).
     *
     * Use clear() for bulk teardown.
     */
    clear() {
        const tagIds = Array.from(this._anchors.keys());
        for (const tagId of tagIds) {
            const record = this._anchors.get(tagId);
            if (record?.anchor?.parent) {
                record.anchor.parent.remove(record.anchor);
            }
            this._anchors.delete(tagId);
        }
        for (const tagId of tagIds) {
            this._eventBus.emit('ANCHOR_REMOVED', { tagId });
        }
    }

    /**
     * Releases all resources and unsubscribes from EventBus.
     *
     * After dispose() the manager must not be used. Create a new instance
     * if needed.
     */
    dispose() {
        this.clear();

        this._eventBus.off('OBJECT_ADDED',   this._onObjectAdded);
        this._eventBus.off('OBJECT_UPDATED', this._onObjectUpdated);
        this._eventBus.off('OBJECT_LOST',    this._onObjectLost);
        this._eventBus.off('OBJECT_REMOVED', this._onObjectRemoved);

        this._scene = null;
    }

    // ------------------------------------------------------------------ //
    //  Private — EventBus Handlers
    // ------------------------------------------------------------------ //

    /**
     * Creates a new Object3D anchor when a tracked object is registered.
     *
     * The anchor is added to the scene root by default.  If the tracked
     * object has a parentId, the anchor is reparented under the parent's
     * anchor so that relative transforms are handled by Three.js's scene
     * graph automatically.
     *
     * @param {{ tagId: number, metadata: Object, trackedObject: Object }} data
     * @private
     */
    _onObjectAdded(data) {
        this._diagCounter++;
        console.log('[DIAG] AnchorManager: GOT OBJECT_ADDED for tag #' + data.tagId + ' (event #' + this._diagCounter + ')');

        if (!this._scene) {
            console.warn('[DIAG] AnchorManager: Scene NOT initialized — cannot create anchor for tag #' + data.tagId);
            return;
        }

        const { tagId, trackedObject } = data;
        const metadata = trackedObject?.metadata || {};
        const parentId = metadata.parentId ?? null;

        // Create the anchor.
        const anchor = new THREE.Object3D();
        anchor.name = `anchor-${tagId}`;
        anchor.userData = { tagId, metadata };

        // matrixAutoUpdate defaults to true on THREE.Object3D — world matrix
        // will be recomputed immediately via updateMatrixWorld(true) on each pose update.

        // Determine the initial position: attach to scene root or parent.
        let targetParent = this._scene;
        if (parentId != null) {
            const parentRecord = this._anchors.get(parentId);
            if (parentRecord) {
                targetParent = parentRecord.anchor;
            } else {
                // Parent not yet registered — attach to scene root for now.
                // The hierarchy will be corrected when the parent arrives.
                console.warn(
                    `AnchorManager: Parent tag ${parentId} not yet registered ` +
                    `for child tag ${tagId}. Anchor attached to scene root.`,
                );
            }
        }

        targetParent.add(anchor);

        // Store the anchor record.
        this._anchors.set(tagId, {
            anchor,
            tagId,
            parentId,
        });

        // If this is a parent, ensure child list is initialized.
        if (!this._anchors.has(tagId)) {
            this._anchors.set(tagId, { anchor, tagId, parentId, childTagIds: [] });
        }

        console.log('[DIAG] AnchorManager: Emitting ANCHOR_CREATED for tag #' + tagId);
        this._eventBus.emit('ANCHOR_CREATED', { tagId, anchor, parentId, metadata });

        console.log(`[DIAG] AnchorManager: Anchor created for tag ${tagId}${parentId ? ` (child of ${parentId})` : ''}.`);
    }

    /**
     * Updates an anchor's transform from the latest filtered pose.
     *
     * The pose contains translation (metres) and rotation (Euler angles
     * in radians).  These are applied directly to the Object3D's
     * position and rotation properties.
     *
     * Because the pose comes from PoseFilter (already EMA-smoothed and
     * outlier-rejected), no additional smoothing is needed here.
     *
     * @param {{ tagId: number, trackedObject: Object }} data
     * @private
     */
    _onObjectUpdated(data) {
        const { tagId, trackedObject } = data;
        const record = this._anchors.get(tagId);
        if (!record) return;

        const pose = trackedObject?.latestPose;
        if (!pose) return;

        const { translation, rotation } = pose;

        // ── Position: convert CV (Y-down, Z-forward) to Three.js (Y-up, Z-backward) ──
        // Shift Z slightly forward (+0.04m) so 3D model floats beyond/outside the physical cardboard model
        record.anchor.position.set(
            translation.x,
            -translation.y,
            -translation.z + 0.04,
        );

        // ── Rotation: use quaternion for drift-free, gimbal-lock-free orientation ──
        if (rotation.quaternion) {
            // Convert from OpenCV (Y-down, Z-forward) to Three.js (Y-up, Z-backward)
            // by negating Y and Z components — same effect as negating pitch/yaw in Euler.
            const q = rotation.quaternion;
            record.anchor.quaternion.set(q.x, -q.y, -q.z, q.w);
        } else {
            // Fallback to Euler (convert pitch/yaw to Three.js OpenGL camera space)
            record.anchor.rotation.set(
                -rotation.euler.x,
                -rotation.euler.y,
                rotation.euler.z,
                'ZYX',
            );
        }

        // Force immediate world-matrix recomputation — frame-for-frame tracking.
        record.anchor.updateMatrixWorld(true);

        // ── Base model scale ──
        // Three.js perspective projection handles Z-depth scaling automatically.
        // A fixed 2.0x base scale ensures the cube visually covers the physical tag.
        record.anchor.scale.setScalar(2.0);

        this._eventBus.emit('ANCHOR_UPDATED', { tagId, anchor: record.anchor });
    }

    /**
     * Handles OBJECT_LOST events.
     *
     * The anchor is intentionally NOT removed when a tag is temporarily
     * lost.  This prevents 3D models from flickering in and out during
     * brief detection gaps.  The anchor stays at its last known pose.
     *
     * @param {{ tagId: number, trackedObject: Object, reason: string }} data
     * @private
     */
    _onObjectLost(data) {
        // Intentionally no action — anchor stays at last known pose.
    }

    /**
     * Removes the anchor when the tracked object is unregistered.
     *
     * @param {{ tagId: number }} data
     * @private
     */
    _onObjectRemoved(data) {
        this.removeAnchor(data.tagId);
    }

    // ------------------------------------------------------------------ //
    //  Private — Hierarchy Helpers
    // ------------------------------------------------------------------ //

    /**
     * Finds all anchors whose parentId matches the given tagId.
     *
     * @param {number} parentTagId
     * @returns {Array<AnchorRecord>}
     * @private
     */
    _findChildren(parentTagId) {
        const children = [];
        for (const record of this._anchors.values()) {
            if (record.parentId === parentTagId) {
                children.push(record);
            }
        }
        return children;
    }
}
