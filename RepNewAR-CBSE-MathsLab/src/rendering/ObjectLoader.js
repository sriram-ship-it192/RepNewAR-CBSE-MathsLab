import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * ObjectLoader.js - Asynchronous 3D Model Loading & Caching Manager
 *
 * Responsibility:
 * - Loads GLTF/GLB 3D models with Draco mesh compression and KTX2 texture compression.
 * - Maintains an in-memory asset cache to avoid duplicate network downloads and parsing.
 * - Clones cached models on request to allow multiple independent instances in the scene.
 * - Provides promise-based asynchronous loading and preloading.
 * - Reports progress and errors via the global EventBus.
 * - Handles GPU resource disposal (geometries, materials, textures) on unload/clear/dispose.
 */
export class ObjectLoader {
    /**
     * @param {EventBus|null} [eventBus=null] - Global event bus instance for lifecycle events.
     * @param {Object} [options={}] - Configuration options for loaders.
     */
    constructor(eventBus = null, options = {}) {
        this._eventBus = eventBus;
        this._renderer = null;

        this._cache = new Map();
        this._pending = new Map();

        this._gltfLoader = new GLTFLoader();

        this._dracoLoader = new DRACOLoader();
        const dracoPath = options.dracoDecoderPath || 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
        this._dracoLoader.setDecoderPath(dracoPath);
        this._gltfLoader.setDRACOLoader(this._dracoLoader);

        this._ktx2Loader = new KTX2Loader();
        const ktx2Path = options.ktx2TranscoderPath || 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/';
        this._ktx2Loader.setTranscoderPath(ktx2Path);
        this._gltfLoader.setKTX2Loader(this._ktx2Loader);
    }

    get loader() {
        return this._gltfLoader;
    }

    get cache() {
        return this._cache;
    }

    initialize(renderer) {
        if (!renderer) {
            console.warn('ObjectLoader.initialize: No WebGLRenderer provided.');
            return this;
        }

        this._renderer = renderer;
        if (this._ktx2Loader && typeof this._ktx2Loader.detectSupport === 'function') {
            try {
                this._ktx2Loader.detectSupport(this._renderer);
            } catch (err) {
                console.warn('ObjectLoader.initialize: Could not detect KTX2 support on renderer:', err?.message || err);
            }
        }

        return this;
    }

    async load(url) {
        if (!url || typeof url !== 'string') {
            const err = new Error('ObjectLoader.load: URL must be a valid non-empty string.');
            this._emit('MODEL_LOAD_ERROR', { url, error: err });
            throw err;
        }

        if (this._cache.has(url)) {
            const masterModel = this._cache.get(url);
            const clone = masterModel.clone(true);
            this._emit('MODEL_LOADED', { url, model: clone, cached: true });
            return clone;
        }

        if (this._pending.has(url)) {
            const masterModel = await this._pending.get(url);
            const clone = masterModel.clone(true);
            this._emit('MODEL_LOADED', { url, model: clone, cached: true });
            return clone;
        }

        this._emit('MODEL_LOADING', { url, loaded: 0, total: 0, progress: 0 });

        const fetchPromise = new Promise((resolve, reject) => {
            this._gltfLoader.load(
                url,
                (gltf) => {
                    const masterScene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                    if (!masterScene) {
                        const err = new Error(`ObjectLoader: GLTF asset at "${url}" contains no root scene.`);
                        this._pending.delete(url);
                        this._emit('MODEL_LOAD_ERROR', { url, error: err });
                        reject(err);
                        return;
                    }

                    this._cache.set(url, masterScene);
                    this._pending.delete(url);
                    resolve(masterScene);
                },
                (xhr) => {
                    const loaded = xhr?.loaded || 0;
                    const total = xhr?.total || 0;
                    const progress = total > 0 ? loaded / total : 0;
                    this._emit('MODEL_LOADING', { url, loaded, total, progress });
                },
                (error) => {
                    this._pending.delete(url);
                    const err = error instanceof Error
                        ? error
                        : new Error(`Failed to load model from "${url}": ${error?.message || error}`);
                    this._emit('MODEL_LOAD_ERROR', { url, error: err });
                    reject(err);
                }
            );
        });

        this._pending.set(url, fetchPromise);

        try {
            const masterScene = await fetchPromise;
            const clone = masterScene.clone(true);
            this._emit('MODEL_LOADED', { url, model: clone, cached: false });
            return clone;
        } catch (err) {
            throw err;
        }
    }

    async preload(urls) {
        if (!urls) return [];
        const urlArray = Array.isArray(urls) ? urls : [urls];
        return Promise.all(urlArray.map((url) => this.load(url)));
    }

    get(url) {
        if (this.has(url)) {
            return this._cache.get(url).clone(true);
        }
        return null;
    }

    has(url) {
        return this._cache.has(url);
    }

    unload(url) {
        if (this._cache.has(url)) {
            const masterModel = this._cache.get(url);
            this._disposeObject(masterModel);
            this._cache.delete(url);
            this._emit('MODEL_UNLOADED', { url });
            return true;
        }
        return false;
    }

    clear() {
        const urls = Array.from(this._cache.keys());
        for (const url of urls) {
            this.unload(url);
        }
        this._cache.clear();
        this._pending.clear();
    }

    clearCache() {
        this.clear();
    }

    dispose() {
        this.clear();

        if (this._dracoLoader) {
            this._dracoLoader.dispose();
        }

        if (this._ktx2Loader) {
            this._ktx2Loader.dispose();
        }

        this._renderer = null;
        this._eventBus = null;
    }

    _emit(eventName, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(eventName, payload);
        }
    }

    _disposeObject(object) {
        if (!object) return;

        object.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }

            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                    if (!mat) continue;

                    for (const key of Object.keys(mat)) {
                        const val = mat[key];
                        if (val && typeof val === 'object' && val.isTexture) {
                            val.dispose();
                        }
                    }

                    mat.dispose();
                }
            }
        });
    }

    /**
     * Applies holographic AR styling to a loaded 3D model.
     * - Replaces mesh materials with a semi-transparent cyan glass finish.
     * - Adds a bright cyan edge wireframe as a child of each mesh.
     * - Places small red accent spheres at the 8 bounding-box corners.
     * - Deduplicates: if 'corner-markers' already exists, it is removed and disposed first.
     *
     * @param {THREE.Object3D} model - The loaded GLTF scene / model to style.
     */
    applyHolographicStyle(model) {
        const holoMat = new THREE.MeshStandardMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.65,
            metalness: 0.2,
            roughness: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        holoMat.renderOrder = 1;

        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
        sphereMat.depthWrite = false;
        sphereMat.renderOrder = 3;

        const sphereGeo = new THREE.SphereGeometry(0.005, 12, 12);

        model.traverse((child) => {
            if (!child.isMesh) return;

            // Dispose old materials
            const oldMats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of oldMats) if (m) m.dispose();
            child.material = holoMat;

            // Remove existing corner-markers to prevent duplicate stacking
            const existing = child.getObjectByName('corner-markers');
            if (existing) {
                existing.parent?.remove(existing);
                existing.traverse((n) => {
                    if (n.geometry) n.geometry.dispose();
                    if (n.material && !Array.isArray(n.material)) n.material.dispose();
                });
            }

            // Cyan edge wireframe — child of mesh so it transforms with it
            const edges = new THREE.EdgesGeometry(child.geometry);
            const wireframe = new THREE.LineSegments(edges, edgeMat);
            child.add(wireframe);

            // Compute exact corner positions from the mesh geometry bounding box
            child.geometry.computeBoundingBox();
            const bb = child.geometry.boundingBox;
            if (bb) {
                const { min, max } = bb;
                const corners = [
                    [min.x, min.y, min.z], [max.x, min.y, min.z],
                    [min.x, max.y, min.z], [max.x, max.y, min.z],
                    [min.x, min.y, max.z], [max.x, min.y, max.z],
                    [min.x, max.y, max.z], [max.x, max.y, max.z],
                ];

                const spheresGroup = new THREE.Group();
                spheresGroup.name = 'corner-markers';
                for (const pos of corners) {
                    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                    sphere.position.set(pos[0], pos[1], pos[2]);
                    spheresGroup.add(sphere);
                }
                child.add(spheresGroup);
            }
        });
    }
}
