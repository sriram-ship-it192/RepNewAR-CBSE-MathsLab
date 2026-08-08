/**
 * EventBus.js - Global Publish/Subscribe System
 *
 * Responsibility:
 * - Provides a centralized communication channel for all modules.
 * - Decouples the Tracking, Rendering, and Content layers.
 *
 * Events:
 * ── Camera Layer (CameraFeed) ──
 * - START_CAMERA:         Request to start the camera feed.
 * - CAMERA_READY:         Camera stream is active.     { deviceId, label, stream }
 * - CAMERA_SWITCHED:      Active camera changed.      { deviceId, label, stream }
 * - CAMERA_STOPPED:       Camera stream stopped.      { }
 * - CAMERA_ERROR:         Camera error occurred.      { error, type }
 * - CAMERA_DISCONNECTED:  Camera hardware removed.    { deviceId }
 *
 * ── Tracking Layer (AprilTagDetector) ──
 * - TAG_DETECTED:         A previously unseen tag is detected.    { tagId, pose, corners, confidence }
 * - TAG_UPDATED:          A known tag's pose has been updated.    { tagId, pose, corners, confidence, age }
 * - TAG_LOST:             A known tag is no longer visible.       { tagId }
 * - TRACKING_STARTED:     Detection loop has started.             { }
 * - TRACKING_STOPPED:     Detection loop has stopped.             { }
 * - TRACKING_ERROR:       WASM detection error.                   { error }
 *
 * ── Tracking Layer (PoseFilter) ──
 * - POSE_FILTERED:        Smoothed pose after EMA + outlier rejection. { tagId, pose, confidence, smoothed }
 * - POSE_RESET:           Filter state cleared for a tag.       { tagId }
 *
 * ── Tracking Layer (TrackerManager) ──
 * - OBJECT_ADDED:         New tracked object registered.      { tagId, metadata, trackedObject }
 * - OBJECT_UPDATED:       Tracked object pose updated.        { tagId, trackedObject }
 * - OBJECT_LOST:          Tracked object temporarily or fully lost. { tagId, trackedObject, reason }
 * - OBJECT_REMOVED:       Tracked object unregistered.        { tagId }
 *
 * ── Rendering Layer (SceneManager) ──
 * - SCENE_READY:          WebGL environment initialized. { scene, camera, renderer, width, height }
 * - RENDER_STARTED:       Render loop has started.       { }
 * - RENDER_STOPPED:       Render loop has stopped.       { }
 * - RENDER_FRAME:         Per-frame timing data.         { deltaTime, frameCount }
 *
 * ── Rendering Layer (AnchorManager) ──
 * - ANCHOR_CREATED:       New Object3D anchor added to scene. { tagId, anchor, parentId }
 * - ANCHOR_UPDATED:       Anchor transform updated from pose. { tagId, anchor }
 * - ANCHOR_REMOVED:       Anchor removed from scene.        { tagId }
 *
 * ── Application Layer ──
 * - APP_STATE_CHANGED:    Global state transition.    { oldState, newState, payload }
 * - LESSON_LOADED:        Lesson plugin loaded.       { lessonId }
 * - UI_STATE_CHANGED:     UI overlay state changed.   { state }
 */

export class EventBus {
    constructor() {
        this.listeners = {};
    }

    on(eventName, callback) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);
    }

    emit(eventName, data) {
        if (this.listeners[eventName]) {
            this.listeners[eventName].forEach(callback => callback(data));
        }
    }

    off(eventName, callback) {
        if (this.listeners[eventName]) {
            this.listeners[eventName] = this.listeners[eventName].filter(cb => cb !== callback);
        }
    }
}
