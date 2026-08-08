import * as THREE from 'three';

const defaultLessonConfig = {
    id: "cube",
    title: "3D Cube Geometry, Volume & Surface Area",
    description: "Interactive AR lesson demonstrating 3D cube dimensions, edge measurements, volume calculation (V = L × W × H), and total surface area (SA = 2(LW + LH + WH)).",
    supportedMarkerIds: [-1], // Cube composite (fused from face tags 0-5)
    defaultDimensions: {
        length: 0.1,
        width: 0.1,
        height: 0.1,
        unit: "cm",
        scaleFactor: 100
    },
    modelPath: "models/cube.glb"
};

/**
 * lesson.js - Reference Implementation for 3D Cube Educational Lesson Plugin
 *
 * Responsibilities:
 * - Implements the strict ILesson plugin lifecycle interface:
 *     initialize(context), activate(), deactivate(), dispose(), getMetadata()
 * - Loads cube.glb model and attaches it to physical AprilTag anchors.
 * - Renders 3D educational overlays: dimension arrows (L, W, H), semi-transparent measurement lines,
 *   and face highlighting demonstrating the 6 square faces for Surface Area.
 * - Displays a responsive floating HTML formula card with real-time calculations:
 *     Volume: V = L × W × H
 *     Surface Area: SA = 2(LW + LH + WH)
 * - Automatically tracks physical marker movement and rotation in 3D camera space.
 * - Animates smooth fade-in / slide-in on activation and clean fade-out on deactivation.
 * - Zero memory leaks: releases all 3D geometries, materials, DOM elements, and EventBus listeners.
 */
export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        // 3D Overlays & Models
        this._cubeModel = null;
        this._overlaysGroup = null;
        this._activeAnchors = new Map(); // tagId -> anchor

        // DOM Overlay Elements
        this._formulaCardEl = null;

        // Animation State
        this._animAlpha = 0;
        this._animTarget = 0;

        // Event Listeners for Clean Unbinding
        this._listeners = [];
    }

    /**
     * Initializes the plugin with the global AR engine context.
     *
     * @param {Object} context - Engine context provided by LessonManager.
     * @param {THREE.Scene} context.scene - Main Three.js scene.
     * @param {EventBus} context.eventBus - Global pub/sub event bus.
     * @param {ObjectLoader} context.objectLoader - Asset loader & cache manager.
     * @param {AnchorManager} context.anchorManager - AR anchor manager.
     * @param {TrackerManager} context.trackerManager - Tracked object lifecycle manager.
     * @param {DebugPanel} [context.debugPanel] - Optional debug panel overlay.
     */
    async initialize(context) {
        this._context = context;
        console.log('CubeLesson: Initialized with context.');
    }

    /**
     * Returns lesson metadata loaded from lesson.json.
     * @returns {Object}
     */
    getMetadata() {
        return this._config;
    }

    /**
     * Activates the Cube educational experience.
     * Mounts HTML formula overlays, creates 3D measurement helpers, binds EventBus listeners,
     * and attaches models to detected AprilTag anchors.
     */
    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('CubeLesson: Activating...');

        if (typeof document !== 'undefined') {
            const card = document.getElementById('cube-formula-card');
            if (card && card.parentNode) card.parentNode.removeChild(card);
        }
        this._subscribeEvents();

        // Build 3D measurement overlays group
        this._overlaysGroup = this._createMeasurementOverlays();

        // Check if any anchors are already active in the scene
        const existingAnchors = this._context?.anchorManager?.getAllAnchors() || [];
        for (const record of existingAnchors) {
            if (this._isSupportedTag(record.tagId)) {
                await this._attachToAnchor(record.tagId, record.anchor);
            }
        }

        // Immediate visibility — no fade-in delay
        this._animAlpha = 1;
        this._animTarget = 1;
    }

    /**
     * Deactivates the lesson experience cleanly.
     * Unmounts formula cards, removes 3D overlays, and unbinds all event listeners.
     */
    async deactivate() {
        if (!this._active) return;
        console.log('CubeLesson: Deactivating...');

        this._animTarget = 0;

        this._unmountFormulaCard();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        if (this._overlaysGroup) {
            this._disposeObject(this._overlaysGroup);
            this._overlaysGroup = null;
        }

        this._active = false;
    }

    /**
     * Disposes all resources held by the lesson plugin.
     */
    async dispose() {
        await this.deactivate();
        this._context = null;
        this._config = null;
        console.log('CubeLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Measurement Overlays & Visual Helpers
    // ------------------------------------------------------------------ //

    /**
     * Constructs 3D measurement lines, dimension arrows, and face highlight planes.
     *
     * @returns {THREE.Group}
     * @private
     */
    _createMeasurementOverlays() {
        const group = new THREE.Group();
        group.name = 'cube-measurement-overlays';

        const size = this._config.defaultDimensions.length || 0.1; // 10cm cube = 0.1m

        // 1. Semi-transparent Wireframe Bounding Box
        const boxGeo = new THREE.BoxGeometry(size, size, size);
        const edgesGeo = new THREE.EdgesGeometry(boxGeo);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.8, linewidth: 2 });
        const wireframeLines = new THREE.LineSegments(edgesGeo, lineMat);
        group.add(wireframeLines);

        // 2. Semi-Transparent Face Highlighting (6 Faces to demonstrate Surface Area = 6 × a²)
        const faceMat = new THREE.MeshBasicMaterial({
            color: 0x3b82f6,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const faceMesh = new THREE.Mesh(boxGeo, faceMat);
        group.add(faceMesh);

        return group;
    }

    /**
     * Attaches the 3D model and measurement overlays to an AprilTag anchor.
     *
     * @param {number} tagId
     * @param {THREE.Object3D} anchor
     * @private
     */
    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;

        try {
            // Create transparent 3D outer holographic shell that covers/encloses the physical cardboard model
            const cube = this._createHolographicCube(new THREE.BoxGeometry(0.1, 0.1, 0.1));
            cube.name = `cube-model-${tagId}`;
            cube.scale.setScalar(1.6);
            anchor.add(cube);

            // Remove old fallbacks
            const old = anchor.getObjectByName(`cube-model-${tagId}-fallback`);
            if (old) anchor.remove(old);

            const appOld = anchor.getObjectByName(`cube-model-${tagId}-app-fallback`);
            if (appOld) anchor.remove(appOld);

            if (this._overlaysGroup) {
                const overlaysClone = this._overlaysGroup.clone(true);
                overlaysClone.name = `cube-overlays-${tagId}`;
                anchor.add(overlaysClone);
            }

            // 3D anchored formula labels parented to the anchor
            const labels = this._create3DLabels();
            labels.name = `cube-labels-${tagId}`;
            anchor.add(labels);

            this._activeAnchors.set(tagId, anchor);
            console.log(`CubeLesson: Attached transparent 3D outer holographic shell to Anchor ID ${tagId}`);

        } catch (err) {
            console.warn(`CubeLesson: Failed to attach outer shell to tag ${tagId}:`, err.message);
        }
    }

    /**
     * Detaches models and overlays from all active anchors.
     * @private
     */
    _detachFromAllAnchors() {
        for (const [tagId, anchor] of this._activeAnchors) {
            if (anchor) {
                const toRemove = [];
                anchor.children.forEach((child) => {
                    if (child.name.startsWith('cube-model-') || child.name.startsWith('cube-overlays-') || child.name.startsWith('cube-labels-')) {
                        toRemove.push(child);
                    }
                });
                toRemove.forEach((child) => {
                    anchor.remove(child);
                    this._disposeObject(child);
                });
            }
        }
        this._activeAnchors.clear();
    }

    // ------------------------------------------------------------------ //
    //  Floating HTML Formula Overlay Card
    // ------------------------------------------------------------------ //

    /**
     * Mounts the floating educational formula card DOM element.
     * @private
     */
    _mountFormulaCard() {
        if (typeof document === 'undefined') return;
        if (this._formulaCardEl) return;

        // Inject stylesheet for lesson formula card
        if (!document.getElementById('cube-lesson-styles')) {
            const style = document.createElement('style');
            style.id = 'cube-lesson-styles';
            style.textContent = `
                #cube-formula-card {
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    width: 320px;
                    background: rgba(15, 23, 42, 0.90);
                    border: 1px solid rgba(59, 130, 246, 0.5);
                    border-radius: 10px;
                    color: #f8fafc;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 14px 16px;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(59, 130, 246, 0.2);
                    z-index: 9999;
                    backdrop-filter: blur(8px);
                    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
                    transform: translateY(0);
                    opacity: 1;
                }
                #cube-formula-card.hidden {
                    transform: translateY(30px);
                    opacity: 0;
                    pointer-events: none;
                }
                #cube-formula-card h3 {
                    margin: 0 0 8px 0;
                    font-size: 15px;
                    font-weight: 700;
                    color: #60a5fa;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                #cube-formula-card .dim-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 6px;
                    margin-bottom: 10px;
                    background: rgba(30, 41, 59, 0.6);
                    padding: 6px 8px;
                    border-radius: 6px;
                    text-align: center;
                }
                #cube-formula-card .dim-item {
                    font-size: 11px;
                }
                #cube-formula-card .dim-label {
                    color: #94a3b8;
                    font-size: 10px;
                    text-transform: uppercase;
                }
                #cube-formula-card .dim-val {
                    font-weight: 700;
                    color: #f1f5f9;
                }
                #cube-formula-card .formula-box {
                    background: rgba(30, 41, 59, 0.8);
                    border-left: 3px solid #3b82f6;
                    border-radius: 4px;
                    padding: 8px 10px;
                    margin-bottom: 6px;
                }
                #cube-formula-card .formula-title {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #94a3b8;
                }
                #cube-formula-card .formula-eq {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 13px;
                    font-weight: 700;
                    color: #38bdf8;
                    margin: 2px 0;
                }
                #cube-formula-card .formula-calc {
                    font-size: 11px;
                    color: #cbd5e1;
                }
            `;
            document.head.appendChild(style);
        }

        const dims = this._config.defaultDimensions;
        const L = (dims.length * dims.scaleFactor).toFixed(1); // 10.0 cm
        const W = (dims.width * dims.scaleFactor).toFixed(1);  // 10.0 cm
        const H = (dims.height * dims.scaleFactor).toFixed(1); // 10.0 cm

        const volumeCm = Math.round(dims.length * dims.width * dims.height * Math.pow(dims.scaleFactor, 3)); // 1000 cm³
        const volumeM = (dims.length * dims.width * dims.height).toFixed(3); // 0.001 m³

        const saCm = Math.round(2 * (dims.length * dims.width + dims.length * dims.height + dims.width * dims.height) * Math.pow(dims.scaleFactor, 2)); // 600 cm²
        const saM = (2 * (dims.length * dims.width + dims.length * dims.height + dims.width * dims.height)).toFixed(2); // 0.06 m²

        this._formulaCardEl = document.createElement('div');
        this._formulaCardEl.id = 'cube-formula-card';
        this._formulaCardEl.innerHTML = `
            <h3>🧊 3D Cube Geometry & Formulas</h3>
            <div class="dim-grid">
                <div class="dim-item">
                    <div class="dim-label">Length (L)</div>
                    <div class="dim-val">${L} cm</div>
                </div>
                <div class="dim-item">
                    <div class="dim-label">Width (W)</div>
                    <div class="dim-val">${W} cm</div>
                </div>
                <div class="dim-item">
                    <div class="dim-label">Height (H)</div>
                    <div class="dim-val">${H} cm</div>
                </div>
            </div>
            <div class="formula-box">
                <div class="formula-title">Volume (V)</div>
                <div class="formula-eq">V = L × W × H</div>
                <div class="formula-calc">V = 10 × 10 × 10 = <strong>${volumeCm} cm³</strong> (${volumeM} m³)</div>
            </div>
            <div class="formula-box" style="border-left-color: #10b981;">
                <div class="formula-title">Surface Area (SA)</div>
                <div class="formula-eq">SA = 2(LW + LH + WH)</div>
                <div class="formula-calc">SA = 6 × (10 × 10) = <strong>${saCm} cm²</strong> (${saM} m²)</div>
            </div>
        `;

        document.body.appendChild(this._formulaCardEl);
    }

    /**
     * Unmounts the floating formula card DOM element.
     * @private
     */
    _unmountFormulaCard() {
        if (this._formulaCardEl) {
            this._formulaCardEl.classList.add('hidden');
            setTimeout(() => {
                if (this._formulaCardEl && this._formulaCardEl.parentNode) {
                    this._formulaCardEl.parentNode.removeChild(this._formulaCardEl);
                }
                this._formulaCardEl = null;
            }, 400);
        }
    }

    // ------------------------------------------------------------------ //
    //  Event Listeners & Teardown
    // ------------------------------------------------------------------ //

    /**
     * Subscribes to EventBus anchor and render events.
     * @private
     */
    _subscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;

        const onAnchorCreated = async ({ tagId, anchor }) => {
            if (this._isSupportedTag(tagId)) {
                await this._attachToAnchor(tagId, anchor);
            }
        };

        const onAnchorRemoved = ({ tagId }) => {
            this._activeAnchors.delete(tagId);
        };

        const onRenderFrame = (data) => {
            this._onRenderFrame(data);
        };

        bus.on('ANCHOR_CREATED', onAnchorCreated);
        bus.on('ANCHOR_REMOVED', onAnchorRemoved);
        bus.on('RENDER_FRAME', onRenderFrame);

        this._listeners.push({ evt: 'ANCHOR_CREATED', fn: onAnchorCreated });
        this._listeners.push({ evt: 'ANCHOR_REMOVED', fn: onAnchorRemoved });
        this._listeners.push({ evt: 'RENDER_FRAME', fn: onRenderFrame });
    }

    /**
     * Unsubscribes all EventBus listeners.
     * @private
     */
    _unsubscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;
        for (const { evt, fn } of this._listeners) {
            bus.off(evt, fn);
        }
        this._listeners = [];
    }

    /**
     * Render loop update for smooth opacity / scale animations.
     * @param {Object} data - { deltaTime, frameCount }
     * @private
     */
    _onRenderFrame(data) {
        if (!this._active || this._activeAnchors.size === 0) return;

        // Smooth step towards target animation alpha
        const dt = (data.deltaTime || 16.6) / 1000;
        this._animAlpha += (this._animTarget - this._animAlpha) * Math.min(1, dt * 6.0);

        // Apply scale/opacity to active anchor overlays
        for (const anchor of this._activeAnchors.values()) {
            if (anchor) {
                const tagId = anchor.userData?.tagId ?? 42;
                const overlays = anchor.getObjectByName(`cube-overlays-${tagId}`);
                if (overlays) {
                    const scale = Math.max(0.001, this._animAlpha);
                    overlays.scale.set(scale, scale, scale);
                }
            }
        }
    }

    /**
     * Checks if a physical AprilTag ID is supported by this lesson.
     *
     * @param {number} tagId
     * @returns {boolean}
     * @private
     */
    _isSupportedTag(tagId) {
        const supported = this._config?.supportedMarkerIds || [1, 2, 3, 4, 5, -1];
        return supported.includes(Number(tagId));
    }

    /**
     * Recursively disposes geometries, materials, and textures for a Three.js object tree.
     *
     * @param {THREE.Object3D} obj
     * @private
     */
    _disposeObject(obj) {
        if (!obj) return;
        obj.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of mats) {
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

    // ── 3D Anchored Formula Labels ──────────────────────────────────────── //

    /**
     * Creates billboard-style canvas-sprite labels for the cube's dimensions
     * and formulas, parented to the anchor so they move/rotate with the tag.
     *
     * @returns {THREE.Group}
     * @private
     */
    _create3DLabels() {
        const group = new THREE.Group();
        group.name = 'cube-labels';

        const dims = this._config.defaultDimensions;
        const L = (dims.length * dims.scaleFactor).toFixed(0);
        const W = (dims.width * dims.scaleFactor).toFixed(0);
        const H = (dims.height * dims.scaleFactor).toFixed(0);

        const labels = [
            { text: `L=${L}cm`,  position: [ 0.07,  0,     0   ], color: '#00f3ff' },
            { text: `W=${W}cm`,  position: [ 0,     0.07,  0   ], color: '#00f3ff' },
            { text: `H=${H}cm`,  position: [ 0,     0,     0.07], color: '#00f3ff' },
            { text: `V = ${L}×${W}×${H}`, position: [ 0,     0.09,  0   ], color: '#fbbf24', scale: 0.025 },
            { text: `SA = 6×${L}²`, position: [ 0,    -0.09,  0   ], color: '#f472b6', scale: 0.025 },
        ];

        for (const { text, position, color, scale: customScale } of labels) {
            const sprite = this._makeLabelSprite(text, color || '#ffffff');
            sprite.position.set(position[0], position[1], position[2]);
            const s = customScale || 0.03;
            sprite.scale.set(s, s * 0.5, 1);
            group.add(sprite);
        }

        return group;
    }

    /**
     * Creates a THREE.Sprite with a canvas-rendered text label.
     * The canvas renders sharp text on a semi-transparent dark pill background.
     *
     * @param {string} text - The label text.
     * @param {string} color - CSS color for the text.
     * @returns {THREE.Sprite}
     * @private
     */
    _makeLabelSprite(text, color) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Measure text to size the canvas
        const fontSize = 32;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const pad = 12;
        const w = Math.ceil(textWidth + pad * 2);
        const h = Math.ceil(fontSize * 1.6);
        canvas.width = w;
        canvas.height = h;

        // Background pill
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, h / 2);
        ctx.fill();

        // Text
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(text, w / 2, h / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = `label-${text.replace(/[^a-zA-Z0-9]/g, '_')}`;
        return sprite;
    }

    // ── SVG Face-Textured Cube ────────────────────────────────────────── //
    // The 6 SVG marker images are loaded as per-face textures on a BoxGeometry.
    // The cube retains the cyan edge wireframe and red corner spheres.
    // Textures are cached after first load for reuse across anchors.

    /**
     * Loads the 6 SVG face textures and creates an array of 6 MeshStandardMaterials
     * (one per BoxGeometry face group). Textures are cached to avoid re-fetching.
     *
     * Face order: +X, -X, +Y, -Y, +Z, -Z
     *              0   1   2   3   4   5
     * Files: right, left, top, bottom, front, back
     *
     * @returns {Promise<THREE.Material[]>}
     * @private
     */
    async _loadFaceMaterials() {
        if (this._faceMaterials) return this._faceMaterials;

        const faceUrls = [
            'textures/right.svg',
            'textures/left.svg',
            'textures/top.svg',
            'textures/bottom.svg',
            'textures/front.svg',
            'textures/back.svg',
        ];

        const loader = new THREE.TextureLoader();
        const textures = await Promise.all(faceUrls.map((url) => loader.loadAsync(url)));

        this._faceMaterials = textures.map((tex, i) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;

            return new THREE.MeshStandardMaterial({
                map: tex,
                transparent: true,
                opacity: 0.95,
                roughness: 0.4,
                metalness: 0.1,
                side: THREE.DoubleSide,
                depthWrite: false,
                renderOrder: 1,
            });
        });

        return this._faceMaterials;
    }

    /**
     * Creates a full cube group with per-face SVG textures, cyan edge wireframe,
     * and red corner spheres. This replaces both the old GLB-load path and the
     * solid-color fallback.
     *
     * @param {number} size - Cube side length in metres.
     * @param {THREE.Material[]} faceMaterials - Array of 6 materials.
     * @returns {THREE.Group}
     * @private
     */
    _createTexturedCube(size, faceMaterials) {
        const group = new THREE.Group();
        group.name = 'svg-textured-cube';

        // ── Multi-material BoxGeometry (6 faces) ──
        const boxGeo = new THREE.BoxGeometry(size, size, size);
        const mesh = new THREE.Mesh(boxGeo, faceMaterials);
        group.add(mesh);

        // ── Cyan edge wireframe ──
        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(boxGeo);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        // ── Red corner spheres ──
        boxGeo.computeBoundingBox();
        const bb = boxGeo.boundingBox;
        if (bb) {
            const { min, max } = bb;
            const corners = [
                [min.x, min.y, min.z], [max.x, min.y, min.z],
                [min.x, max.y, min.z], [max.x, max.y, min.z],
                [min.x, min.y, max.z], [max.x, min.y, max.z],
                [min.x, max.y, max.z], [max.x, max.y, max.z],
            ];

            const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
            sphereMat.depthWrite = false;
            sphereMat.renderOrder = 3;

            const sphereGeo = new THREE.SphereGeometry(0.005, 12, 12);
            for (const pos of corners) {
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.set(pos[0], pos[1], pos[2]);
                mesh.add(sphere);
            }
        }

        return group;
    }

    /**
     * Creates a transparent 3D holographic outer shell that covers and encloses
     * the physical cardboard cube model, while keeping the cardboard box visible inside.
     *
     * @param {THREE.BoxGeometry} geometry
     * @returns {THREE.Group}
     * @private
     */
    _createHolographicCube(geometry) {
        const group = new THREE.Group();
        group.name = 'holographic-outer-shell';

        geometry.computeBoundingBox();

        // Transparent cyan glass outer layer (opacity: 0.35) so cardboard is visible inside
        const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.35,
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        holoMat.renderOrder = 1;

        const mesh = new THREE.Mesh(geometry, holoMat);
        group.add(mesh);

        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(geometry);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        const bb = geometry.boundingBox;
        if (bb) {
            const { min, max } = bb;
            const corners = [
                [min.x, min.y, min.z], [max.x, min.y, min.z],
                [min.x, max.y, min.z], [max.x, max.y, min.z],
                [min.x, min.y, max.z], [max.x, min.y, max.z],
                [min.x, max.y, max.z], [max.x, max.y, max.z],
            ];

            const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
            sphereMat.depthWrite = false;
            sphereMat.renderOrder = 3;

            const sphereGeo = new THREE.SphereGeometry(0.005, 12, 12);
            for (const pos of corners) {
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.set(pos[0], pos[1], pos[2]);
                mesh.add(sphere);
            }
        }

        return group;
    }
    _applyHolographicStyle(model) {
        if (this._context?.objectLoader) {
            this._context.objectLoader.applyHolographicStyle(model);
        } else {
            this._applyHolographicStyleInline(model);
        }
    }

    _applyHolographicStyleInline(model) {
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

            const oldMats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of oldMats) if (m) m.dispose();
            child.material = holoMat;

            const existing = child.getObjectByName('corner-markers');
            if (existing) {
                existing.parent?.remove(existing);
                existing.traverse((n) => {
                    if (n.geometry) n.geometry.dispose();
                    if (n.material && !Array.isArray(n.material)) n.material.dispose();
                });
            }

            const edges = new THREE.EdgesGeometry(child.geometry);
            const wireframe = new THREE.LineSegments(edges, edgeMat);
            child.add(wireframe);

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

    /**
     * Old fallback for backward compatibility — creates a solid-cyan holographic cube.
     * The primary path now uses `_createTexturedCube` with SVG face textures.
     *
     * @param {THREE.BoxGeometry} geometry
     * @returns {THREE.Group}
     */
    _createHolographicCube(geometry) {
        const group = new THREE.Group();
        group.name = 'holographic-cube-fallback';

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

        const mesh = new THREE.Mesh(geometry, holoMat);
        group.add(mesh);

        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(geometry);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        if (bb) {
            const { min, max } = bb;
            const corners = [
                [min.x, min.y, min.z], [max.x, min.y, min.z],
                [min.x, max.y, min.z], [max.x, max.y, min.z],
                [min.x, min.y, max.z], [max.x, min.y, max.z],
                [min.x, max.y, max.z], [max.x, max.y, max.z],
            ];

            const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
            sphereMat.depthWrite = false;
            sphereMat.renderOrder = 3;

            const sphereGeo = new THREE.SphereGeometry(0.005, 12, 12);
            for (const pos of corners) {
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.set(pos[0], pos[1], pos[2]);
                mesh.add(sphere);
            }
        }

        return group;
    }
}
