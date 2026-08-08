import * as TWEEN from '@tweenjs/tween.js';

/**
 * AnimationEngine.js - Reusable Visual Animation & Interpolation Service
 *
 * Responsibility:
 * - Provides reusable animation services (Rotation, Translation, Scaling, Fade In/Out,
 *   Pulse, Bounce, Orbit, Custom Tweens, Sequences, and Parallel Groups).
 * - Entirely decoupled from lesson-specific logic or geometry calculations (NO cube/pyramid/pizza logic).
 * - Works seamlessly on Three.js Object3D / Mesh / Group, HTML Elements, and Plain JS Objects.
 * - Operates on a SINGLE shared update loop tied to SceneManager's RENDER_FRAME event
 *   (zero additional requestAnimationFrame calls).
 * - Supports hundreds of simultaneous active animations smoothly.
 * - Completely event-driven via EventBus.
 * - Rigorous memory management: releases Tweens, Group references, target maps, timers, and listeners.
 *
 * Public API:
 * - initialize(options?)
 * - animate(target, config)
 * - sequence(id, animations)
 * - parallel(id, animations)
 * - pause(id)
 * - resume(id)
 * - stop(id)
 * - reset(target)
 * - stopAll()
 * - update(time?)
 * - dispose()
 *
 * Events emitted via EventBus:
 * - ANIMATION_STARTED    { id, target, type }
 * - ANIMATION_UPDATED    { id, target, progress }
 * - ANIMATION_COMPLETED  { id, target }
 * - ANIMATION_STOPPED    { id, target }
 * - ANIMATION_PAUSED     { id, target }
 * - ANIMATION_RESUMED    { id, target }
 * - ANIMATION_ERROR      { id, target, error }
 */
export class AnimationEngine {
    /**
     * @param {EventBus|null} [eventBus=null] - The global pub/sub event bus instance.
     * @param {Object} [options={}] - Configuration options.
     */
    constructor(eventBus = null, options = {}) {
        this._eventBus = eventBus;
        this._tweenGroup = new TWEEN.Group();

        /** @type {Map<string, Object>} Map of active animation records by ID */
        this._animations = new Map();

        /** @type {Map<Object, Set<string>>} Map of targets to set of animation IDs */
        this._targetAnimations = new Map();

        this._listeners = [];
        this._initialized = false;
        this._idCounter = 0;

        this._options = {
            autoUpdate: true,
            defaultDuration: 1000,
            defaultEasing: 'Quadratic.Out',
            ...options,
        };

        if (options.autoInitialize !== false) {
            this.initialize(this._options);
        }
    }

    /**
     * Initializes the AnimationEngine and subscribes to RENDER_FRAME for single-loop updates.
     *
     * @param {Object} [options={}] - Configuration options.
     * @returns {AnimationEngine} returns this instance for chaining.
     */
    initialize(options = {}) {
        this._options = { ...this._options, ...options };

        this._bindEventBus();

        this._initialized = true;
        console.log('AnimationEngine: Initialized.');
        return this;
    }

    /**
     * Updates all active tweens in the shared TWEEN group.
     * Called automatically via RENDER_FRAME or manually during tests.
     *
     * @param {number} [time] - Current timestamp in ms (defaults to performance.now()).
     */
    update(time) {
        if (this._tweenGroup) {
            this._tweenGroup.update(time !== undefined ? time : performance.now());
        }
    }

    /**
     * Animates properties of a target object (Three.js Object3D, HTML Element, or Plain JS Object).
     *
     * @param {Object|HTMLElement} target - The object to animate.
     * @param {Object} config - Animation configuration.
     * @param {string} [config.id] - Optional unique animation ID (auto-generated if omitted).
     * @param {string} [config.type] - Preset type: 'rotation'|'translation'|'scale'|'fadeIn'|'fadeOut'|'pulse'|'bounce'|'orbit'|'custom'.
     * @param {Object} [config.to] - Target property values.
     * @param {Object} [config.from] - Initial property values.
     * @param {number} [config.duration=1000] - Duration in ms.
     * @param {number} [config.delay=0] - Delay in ms.
     * @param {string|Function} [config.easing='Quadratic.Out'] - Easing function or string name.
     * @param {number} [config.repeat=0] - Number of repeats (Infinity for loop).
     * @param {boolean} [config.yoyo=false] - Reverse back and forth.
     * @param {Function} [config.onUpdate] - Frame update callback.
     * @param {Function} [config.onComplete] - Completion callback.
     * @returns {Object} Animation handle.
     */
    animate(target, config = {}) {
        if (!target) {
            const err = new Error('AnimationEngine.animate: target object is required.');
            this._emit('ANIMATION_ERROR', { id: config?.id || 'unknown', target, error: err });
            throw err;
        }

        const id = config.id || `anim_${++this._idCounter}_${Date.now()}`;
        const type = config.type || 'custom';

        if (this._animations.has(id)) {
            this.stop(id);
        }

        try {
            const parsedConfig = this._prepareAnimationConfig(target, config);
            const tween = this._createTween(target, parsedConfig, id);

            const record = {
                id,
                target,
                type,
                config: parsedConfig,
                tween,
                status: 'running',
                isGroup: false,
                initialState: this._captureTargetState(target),
            };

            this._registerAnimation(id, target, record);
            this._tweenGroup.add(tween);

            tween.start();
            this._emit('ANIMATION_STARTED', { id, target, type });

            return record;

        } catch (err) {
            const error = new Error(`AnimationEngine: Failed to start animation "${id}": ${err.message || err}`);
            this._emit('ANIMATION_ERROR', { id, target, error });
            throw error;
        }
    }

    /**
     * Creates a sequential chain of animations (runs step 0 -> step 1 -> step 2 -> completion).
     *
     * @param {string} id - Unique sequence ID.
     * @param {Array<Object>} animations - Array of animation configs/handles.
     * @returns {Object} Sequence record handle.
     */
    sequence(id, animations = []) {
        if (!id || !Array.isArray(animations) || animations.length === 0) {
            const err = new Error('AnimationEngine.sequence: valid id and non-empty animations array required.');
            this._emit('ANIMATION_ERROR', { id, error: err });
            throw err;
        }

        if (this._animations.has(id)) {
            this.stop(id);
        }

        const record = {
            id,
            type: 'sequence',
            status: 'running',
            isGroup: true,
            animations: [...animations],
            currentIndex: 0,
            currentActiveId: null,
        };

        this._animations.set(id, record);
        this._emit('ANIMATION_STARTED', { id, target: null, type: 'sequence' });

        const runNext = (index) => {
            if (index >= animations.length) {
                record.status = 'completed';
                this._emit('ANIMATION_COMPLETED', { id, target: null });
                this._unregisterAnimation(id);
                return;
            }

            record.currentIndex = index;
            const stepConfig = animations[index];
            const stepId = `${id}_seq_${index}`;
            record.currentActiveId = stepId;

            const target = stepConfig.target || stepConfig.object;
            const originalOnComplete = stepConfig.onComplete;

            this.animate(target, {
                ...stepConfig,
                id: stepId,
                onComplete: (t) => {
                    if (originalOnComplete) originalOnComplete(t);
                    if (record.status === 'running') {
                        runNext(index + 1);
                    }
                },
            });
        };

        runNext(0);
        return record;
    }

    /**
     * Runs multiple animations simultaneously in parallel.
     *
     * @param {string} id - Unique parallel group ID.
     * @param {Array<Object>} animations - Array of animation configs/handles.
     * @returns {Object} Parallel group record handle.
     */
    parallel(id, animations = []) {
        if (!id || !Array.isArray(animations) || animations.length === 0) {
            const err = new Error('AnimationEngine.parallel: valid id and non-empty animations array required.');
            this._emit('ANIMATION_ERROR', { id, error: err });
            throw err;
        }

        if (this._animations.has(id)) {
            this.stop(id);
        }

        const record = {
            id,
            type: 'parallel',
            status: 'running',
            isGroup: true,
            activeCount: animations.length,
            childIds: [],
        };

        this._animations.set(id, record);
        this._emit('ANIMATION_STARTED', { id, target: null, type: 'parallel' });

        let remaining = animations.length;

        animations.forEach((stepConfig, index) => {
            const stepId = `${id}_par_${index}`;
            record.childIds.push(stepId);

            const target = stepConfig.target || stepConfig.object;
            const originalOnComplete = stepConfig.onComplete;

            this.animate(target, {
                ...stepConfig,
                id: stepId,
                onComplete: (t) => {
                    if (originalOnComplete) originalOnComplete(t);
                    remaining--;
                    if (remaining <= 0 && record.status === 'running') {
                        record.status = 'completed';
                        this._emit('ANIMATION_COMPLETED', { id, target: null });
                        this._unregisterAnimation(id);
                    }
                },
            });
        });

        return record;
    }

    /**
     * Pauses an active animation, sequence, or parallel group.
     *
     * @param {string} id - Animation ID to pause.
     */
    pause(id) {
        const record = this._animations.get(id);
        if (!record || record.status !== 'running') return;

        record.status = 'paused';

        if (record.isGroup) {
            if (record.type === 'sequence' && record.currentActiveId) {
                this.pause(record.currentActiveId);
            } else if (record.type === 'parallel' && record.childIds) {
                record.childIds.forEach((childId) => this.pause(childId));
            }
        } else if (record.tween) {
            record.tween.pause();
        }

        this._emit('ANIMATION_PAUSED', { id, target: record.target });
    }

    /**
     * Resumes a paused animation, sequence, or parallel group.
     *
     * @param {string} id - Animation ID to resume.
     */
    resume(id) {
        const record = this._animations.get(id);
        if (!record || record.status !== 'paused') return;

        record.status = 'running';

        if (record.isGroup) {
            if (record.type === 'sequence' && record.currentActiveId) {
                this.resume(record.currentActiveId);
            } else if (record.type === 'parallel' && record.childIds) {
                record.childIds.forEach((childId) => this.resume(childId));
            }
        } else if (record.tween) {
            record.tween.resume();
        }

        this._emit('ANIMATION_RESUMED', { id, target: record.target });
    }

    /**
     * Stops an animation, sequence, or parallel group and removes it.
     *
     * @param {string} id - Animation ID to stop.
     */
    stop(id) {
        const record = this._animations.get(id);
        if (!record) return;

        record.status = 'stopped';

        if (record.isGroup) {
            if (record.type === 'sequence' && record.currentActiveId) {
                this.stop(record.currentActiveId);
            } else if (record.type === 'parallel' && record.childIds) {
                record.childIds.forEach((childId) => this.stop(childId));
            }
        } else if (record.tween) {
            record.tween.stop();
            this._tweenGroup.remove(record.tween);
        }

        this._emit('ANIMATION_STOPPED', { id, target: record.target });
        this._unregisterAnimation(id);
    }

    /**
     * Stops all active animations targeting a specific object and restores its initial state.
     *
     * @param {Object|HTMLElement} target - Target object to reset.
     */
    reset(target) {
        if (!target) return;

        const animIds = this._targetAnimations.get(target);
        if (animIds) {
            const idsToStop = Array.from(animIds);
            for (const id of idsToStop) {
                const record = this._animations.get(id);
                if (record && record.initialState) {
                    this._restoreTargetState(target, record.initialState);
                }
                this.stop(id);
            }
        }
    }

    /**
     * Stops all active animations across the entire engine.
     */
    stopAll() {
        const ids = Array.from(this._animations.keys());
        for (const id of ids) {
            this.stop(id);
        }
        if (this._tweenGroup) {
            this._tweenGroup.removeAll();
        }
        this._animations.clear();
        this._targetAnimations.clear();
        console.log('AnimationEngine: Stopped all animations.');
    }

    /**
     * Releases all active tweens, group references, timers, and event listeners.
     */
    dispose() {
        this.stopAll();
        this._unbindEventBus();

        this._tweenGroup = null;
        this._initialized = false;
        console.log('AnimationEngine: Disposed.');
    }

    _prepareAnimationConfig(target, config) {
        const type = config.type || 'custom';
        const duration = config.duration !== undefined ? config.duration : this._options.defaultDuration;
        const delay = config.delay || 0;
        const easing = this._resolveEasing(config.easing || this._options.defaultEasing);

        let from = config.from ? { ...config.from } : null;
        let to = config.to ? { ...config.to } : {};

        switch (type) {
            case 'rotation':
            case 'rotate':
                if (!to.x && !to.y && !to.z) {
                    to = { x: target.rotation?.x || 0, y: (target.rotation?.y || 0) + Math.PI * 2, z: target.rotation?.z || 0 };
                }
                break;

            case 'translation':
            case 'translate':
            case 'position':
                if (to.x === undefined) to.x = target.position?.x || 0;
                if (to.y === undefined) to.y = target.position?.y || 0;
                if (to.z === undefined) to.z = target.position?.z || 0;
                break;

            case 'scale':
                if (typeof to.scale === 'number') {
                    const s = to.scale;
                    to = { x: s, y: s, z: s };
                }
                break;

            case 'fadeIn':
                from = { opacity: 0 };
                to = { opacity: 1 };
                break;

            case 'fadeOut':
                from = { opacity: 1 };
                to = { opacity: 0 };
                break;

            case 'pulse':
                if (!config.to) {
                    const s = 1.15;
                    to = { x: (target.scale?.x || 1) * s, y: (target.scale?.y || 1) * s, z: (target.scale?.z || 1) * s };
                }
                config.repeat = config.repeat !== undefined ? config.repeat : Infinity;
                config.yoyo = config.yoyo !== undefined ? config.yoyo : true;
                break;

            case 'bounce':
                if (!config.to) {
                    to = { y: (target.position?.y || 0) + 0.1 };
                }
                config.easing = config.easing || 'Bounce.Out';
                config.yoyo = config.yoyo !== undefined ? config.yoyo : true;
                break;

            case 'orbit':
                to = { y: (target.rotation?.y || 0) + Math.PI * 2 };
                config.repeat = config.repeat !== undefined ? config.repeat : Infinity;
                break;
        }

        return {
            ...config,
            type,
            duration,
            delay,
            easing,
            from,
            to,
        };
    }

    _createTween(target, config, id) {
        const isThreeObj = target.isObject3D || (target.position && target.rotation && target.scale);
        const isHTMLElement = typeof HTMLElement !== 'undefined' && target instanceof HTMLElement;

        let startState = {};
        let endState = { ...config.to };

        if (isThreeObj) {
            if (endState.x !== undefined || endState.y !== undefined || endState.z !== undefined) {
                if (config.type === 'rotation' || config.type === 'orbit') {
                    startState = { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z };
                } else if (config.type === 'scale' || config.type === 'pulse') {
                    startState = { x: target.scale.x, y: target.scale.y, z: target.scale.z };
                } else {
                    startState = { x: target.position.x, y: target.position.y, z: target.position.z };
                }
            }
            if (endState.opacity !== undefined) {
                const mat = Array.isArray(target.material) ? target.material[0] : target.material;
                startState.opacity = mat ? mat.opacity : 1;
            }
        } else if (isHTMLElement) {
            if (endState.opacity !== undefined) {
                startState.opacity = parseFloat(target.style.opacity || '1');
            }
        } else {
            for (const key of Object.keys(endState)) {
                startState[key] = target[key] !== undefined ? target[key] : 0;
            }
        }

        if (config.from) {
            startState = { ...startState, ...config.from };
        }

        const tween = new TWEEN.Tween(startState)
            .to(endState, config.duration)
            .delay(config.delay)
            .easing(config.easing);

        if (config.repeat !== undefined) {
            tween.repeat(config.repeat);
        }
        if (config.yoyo) {
            tween.yoyo(true);
        }

        tween.onUpdate((state, elapsed) => {
            this._applyStateToTarget(target, state, config.type);
            this._emit('ANIMATION_UPDATED', { id, target, progress: elapsed });

            if (typeof config.onUpdate === 'function') {
                config.onUpdate(target, elapsed);
            }
        });

        tween.onComplete(() => {
            this._emit('ANIMATION_COMPLETED', { id, target });

            if (typeof config.onComplete === 'function') {
                config.onComplete(target);
            }

            this._unregisterAnimation(id);
        });

        return tween;
    }

    _applyStateToTarget(target, state, type) {
        const isThreeObj = target.isObject3D || (target.position && target.rotation && target.scale);
        const isHTMLElement = typeof HTMLElement !== 'undefined' && target instanceof HTMLElement;

        if (isThreeObj) {
            if (type === 'rotation' || type === 'orbit') {
                if (state.x !== undefined) target.rotation.x = state.x;
                if (state.y !== undefined) target.rotation.y = state.y;
                if (state.z !== undefined) target.rotation.z = state.z;
            } else if (type === 'scale' || type === 'pulse') {
                if (state.x !== undefined) target.scale.x = state.x;
                if (state.y !== undefined) target.scale.y = state.y;
                if (state.z !== undefined) target.scale.z = state.z;
            } else {
                if (state.x !== undefined) target.position.x = state.x;
                if (state.y !== undefined) target.position.y = state.y;
                if (state.z !== undefined) target.position.z = state.z;
            }

            if (state.opacity !== undefined && target.material) {
                const mats = Array.isArray(target.material) ? target.material : [target.material];
                for (const mat of mats) {
                    if (mat) {
                        mat.transparent = true;
                        mat.opacity = state.opacity;
                    }
                }
            }
        } else if (isHTMLElement) {
            if (state.opacity !== undefined) {
                target.style.opacity = state.opacity;
            }
        } else {
            Object.assign(target, state);
        }
    }

    _captureTargetState(target) {
        if (!target) return null;
        if (target.isObject3D || (target.position && target.rotation && target.scale)) {
            return {
                position: { x: target.position.x, y: target.position.y, z: target.position.z },
                rotation: { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z },
                scale: { x: target.scale.x, y: target.scale.y, z: target.scale.z },
                opacity: target.material ? (Array.isArray(target.material) ? target.material[0]?.opacity : target.material?.opacity) : 1,
            };
        }
        if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
            return { opacity: target.style.opacity, transform: target.style.transform };
        }
        return { ...target };
    }

    _restoreTargetState(target, state) {
        if (!target || !state) return;
        if (target.isObject3D || (target.position && target.rotation && target.scale)) {
            if (state.position) target.position.set(state.position.x, state.position.y, state.position.z);
            if (state.rotation) target.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
            if (state.scale) target.scale.set(state.scale.x, state.scale.y, state.scale.z);
            if (state.opacity !== undefined && target.material) {
                const mats = Array.isArray(target.material) ? target.material : [target.material];
                for (const m of mats) if (m) m.opacity = state.opacity;
            }
        } else if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
            if (state.opacity !== undefined) target.style.opacity = state.opacity;
            if (state.transform !== undefined) target.style.transform = state.transform;
        } else {
            Object.assign(target, state);
        }
    }

    _resolveEasing(easing) {
        if (typeof easing === 'function') return easing;
        if (typeof easing === 'string') {
            const parts = easing.split('.');
            if (parts.length === 2 && TWEEN.Easing[parts[0]] && TWEEN.Easing[parts[0]][parts[1]]) {
                return TWEEN.Easing[parts[0]][parts[1]];
            }
            if (TWEEN.Easing[easing]) return TWEEN.Easing[easing];
        }
        return TWEEN.Easing.Quadratic.Out;
    }

    _registerAnimation(id, target, record) {
        this._animations.set(id, record);
        if (target) {
            if (!this._targetAnimations.has(target)) {
                this._targetAnimations.set(target, new Set());
            }
            this._targetAnimations.get(target).add(id);
        }
    }

    _unregisterAnimation(id) {
        const record = this._animations.get(id);
        if (record) {
            if (record.target && this._targetAnimations.has(record.target)) {
                const set = this._targetAnimations.get(record.target);
                set.delete(id);
                if (set.size === 0) {
                    this._targetAnimations.delete(record.target);
                }
            }
            this._animations.delete(id);
        }
    }

    _emit(evt, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(evt, payload);
        }
    }

    _bindEventBus() {
        if (!this._eventBus) return;

        const onRenderFrame = () => {
            this.update();
        };

        this._eventBus.on('RENDER_FRAME', onRenderFrame);
        this._listeners.push({ evt: 'RENDER_FRAME', fn: onRenderFrame });
    }

    _unbindEventBus() {
        if (!this._eventBus) return;
        for (const { evt, fn } of this._listeners) {
            this._eventBus.off(evt, fn);
        }
        this._listeners = [];
    }
}
