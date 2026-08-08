import * as THREE from 'three';

const defaultLessonConfig = {
    id: "algebraic_identities",
    title: "Algebraic Identities: (a+b)² & (a+b)³",
    category: "Algebra & Geometry",
    description: "AR 3D tile and block visualizer proving algebraic identities (a+b)² = a² + 2ab + b² and (a+b)³ = a³ + 3a²b + 3ab² + b³ using physical kit blocks.",
    supportedMarkerIds: [1, 2, 3, 4, 5, -1],
    defaultDimensions: { a: 3, b: 2 }
};

export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        this._activeAnchors = new Map();
        this._a = 3;
        this._b = 2;
        this._mode = '2d'; // '2d' for (a+b)², '3d' for (a+b)³
        this._explode = 0.2; // separation gap factor

        this._uiCardEl = null;
        this._listeners = [];
    }

    async initialize(context) {
        this._context = context;
        console.log('AlgebraicIdentitiesLesson: Initialized.');
    }

    getMetadata() {
        return this._config;
    }

    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('AlgebraicIdentitiesLesson: Activating...');

        this._mountUI();
        this._subscribeEvents();

        const existingAnchors = this._context?.anchorManager?.getAllAnchors() || [];
        for (const record of existingAnchors) {
            if (this._isSupportedTag(record.tagId)) {
                await this._attachToAnchor(record.tagId, record.anchor);
            }
        }

        if (this._activeAnchors.size === 0 && this._context?.scene) {
            const fallbackGroup = new THREE.Group();
            fallbackGroup.name = 'algebraic-fallback-anchor';
            fallbackGroup.position.set(0, 0, -0.3);
            this._context.scene.add(fallbackGroup);
            this._attachToAnchor(-1, fallbackGroup);
        }
    }

    async deactivate() {
        if (!this._active) return;
        console.log('AlgebraicIdentitiesLesson: Deactivating...');

        this._unmountUI();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        const fallback = this._context?.scene?.getObjectByName('algebraic-fallback-anchor');
        if (fallback) {
            this._context.scene.remove(fallback);
            this._disposeObject(fallback);
        }

        this._active = false;
    }

    async dispose() {
        await this.deactivate();
        this._context = null;
        this._config = null;
        console.log('AlgebraicIdentitiesLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Block Construction
    // ------------------------------------------------------------------ //

    _buildIdentityBlocks() {
        const group = new THREE.Group();
        group.name = 'algebraic-blocks-group';

        const scale = 0.02; // scale unit to meters
        const aVal = this._a * scale;
        const bVal = this._b * scale;
        const gap = this._explode * 0.015;

        // Colors for terms: a^2 / a^3 (blue), ab / a^2b (green), b^2 / ab^2 (yellow), b^3 (red)
        const matA2 = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9, roughness: 0.2 });
        const matAB = new THREE.MeshStandardMaterial({ color: 0x10b981, transparent: true, opacity: 0.9, roughness: 0.2 });
        const matB2 = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9, roughness: 0.2 });
        const matB3 = new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.9, roughness: 0.2 });

        const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.6, transparent: true });

        if (this._mode === '2d') {
            // (a + b)^2 = a^2 + 2ab + b^2
            // 1. Block a^2 (a x a x h)
            const h = 0.005; // thin tile height
            this._createSubBlock(group, aVal, aVal, h, -bVal / 2 - gap, -bVal / 2 - gap, 0, matA2, edgeMat, 'a²');

            // 2. Block ab #1 (a x b x h)
            this._createSubBlock(group, aVal, bVal, h, -bVal / 2 - gap, aVal / 2 + gap, 0, matAB, edgeMat, 'ab');

            // 3. Block ab #2 (b x a x h)
            this._createSubBlock(group, bVal, aVal, h, aVal / 2 + gap, -bVal / 2 - gap, 0, matAB, edgeMat, 'ab');

            // 4. Block b^2 (b x b x h)
            this._createSubBlock(group, bVal, bVal, h, aVal / 2 + gap, aVal / 2 + gap, 0, matB2, edgeMat, 'b²');
        } else {
            // (a + b)^3 = a^3 + 3a^2b + 3ab^2 + b^3 (8 sub-cubes)
            const offA = -bVal / 2 - gap;
            const offB = aVal / 2 + gap;

            // 1. a^3 (a x a x a)
            this._createSubBlock(group, aVal, aVal, aVal, offA, offA, offA, matA2, edgeMat, 'a³');

            // 2. 3 x a^2b (a x a x b)
            this._createSubBlock(group, aVal, aVal, bVal, offA, offA, offB, matAB, edgeMat, 'a²b');
            this._createSubBlock(group, aVal, bVal, aVal, offA, offB, offA, matAB, edgeMat, 'a²b');
            this._createSubBlock(group, bVal, aVal, aVal, offB, offA, offA, matAB, edgeMat, 'a²b');

            // 3. 3 x ab^2 (a x b x b)
            this._createSubBlock(group, aVal, bVal, bVal, offA, offB, offB, matB2, edgeMat, 'ab²');
            this._createSubBlock(group, bVal, aVal, bVal, offB, offA, offB, matB2, edgeMat, 'ab²');
            this._createSubBlock(group, bVal, bVal, aVal, offB, offB, offA, matB2, edgeMat, 'ab²');

            // 4. b^3 (b x b x b)
            this._createSubBlock(group, bVal, bVal, bVal, offB, offB, offB, matB3, edgeMat, 'b³');
        }

        return group;
    }

    _createSubBlock(parent, wx, wy, wz, px, py, pz, mat, edgeMat, label) {
        const geo = new THREE.BoxGeometry(wx, wy, wz);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py, pz);
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        parent.add(mesh);
    }

    // ------------------------------------------------------------------ //
    //  AR Anchoring & UI
    // ------------------------------------------------------------------ //

    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;
        this._detachFromAnchor(tagId);

        const blocks = this._buildIdentityBlocks();
        blocks.name = `algebraic-blocks-${tagId}`;
        anchor.add(blocks);
        this._activeAnchors.set(tagId, anchor);
    }

    _detachFromAnchor(tagId) {
        const anchor = this._activeAnchors.get(tagId);
        if (anchor) {
            const old = anchor.getObjectByName(`algebraic-blocks-${tagId}`);
            if (old) {
                anchor.remove(old);
                this._disposeObject(old);
            }
            this._activeAnchors.delete(tagId);
        }
    }

    _detachFromAllAnchors() {
        for (const tagId of Array.from(this._activeAnchors.keys())) {
            this._detachFromAnchor(tagId);
        }
    }

    _updateAllAnchors() {
        for (const [tagId, anchor] of this._activeAnchors) {
            if (anchor) {
                const old = anchor.getObjectByName(`algebraic-blocks-${tagId}`);
                if (old) {
                    anchor.remove(old);
                    this._disposeObject(old);
                }
                const newBlocks = this._buildIdentityBlocks();
                newBlocks.name = `algebraic-blocks-${tagId}`;
                anchor.add(newBlocks);
            }
        }
    }

    _mountUI() {
        if (typeof document === 'undefined' || this._uiCardEl) return;

        if (!document.getElementById('algebraic-styles')) {
            const style = document.createElement('style');
            style.id = 'algebraic-styles';
            style.textContent = `
                #algebraic-card {
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    width: 320px;
                    background: rgba(15, 23, 42, 0.92);
                    border: 1px solid rgba(59, 130, 246, 0.5);
                    border-radius: 10px;
                    color: #f8fafc;
                    font-family: system-ui, sans-serif;
                    padding: 14px 16px;
                    z-index: 9999;
                    backdrop-filter: blur(8px);
                }
                #algebraic-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 15px;
                    color: #60a5fa;
                }
                .algebraic-row {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .algebraic-btn {
                    flex: 1;
                    padding: 6px;
                    background: #1e293b;
                    border: 1px solid #475569;
                    color: #fff;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .algebraic-btn.active {
                    background: #2563eb;
                    border-color: #60a5fa;
                }
                .calc-box {
                    background: rgba(30, 41, 59, 0.8);
                    border-left: 3px solid #38bdf8;
                    padding: 8px;
                    margin-top: 10px;
                    font-size: 12px;
                    border-radius: 4px;
                }
            `;
            document.head.appendChild(style);
        }

        this._uiCardEl = document.createElement('div');
        this._uiCardEl.id = 'algebraic-card';
        this._renderUIContent();
        document.body.appendChild(this._uiCardEl);

        this._bindUIEvents();
    }

    _renderUIContent() {
        if (!this._uiCardEl) return;

        const a = this._a, b = this._b;
        const lhs = this._mode === '2d' ? Math.pow(a + b, 2) : Math.pow(a + b, 3);
        const formula = this._mode === '2d'
            ? `(${a} + ${b})² = ${a}² + 2(${a})(${b}) + ${b}² = ${a * a} + ${2 * a * b} + ${b * b} = ${lhs}`
            : `(${a} + ${b})³ = ${a}³ + 3(${a}²)(${b}) + 3(${a})(${b}²) + ${b}³ = ${a * a * a} + ${3 * a * a * b} + ${3 * a * b * b} + ${b * b * b} = ${lhs}`;

        this._uiCardEl.innerHTML = `
            <h3>🧩 Algebraic Identity Visualizer</h3>
            <div class="algebraic-row">
                <button class="algebraic-btn ${this._mode === '2d' ? 'active' : ''}" id="btn-mode-2d">(a+b)² Square</button>
                <button class="algebraic-btn ${this._mode === '3d' ? 'active' : ''}" id="btn-mode-3d">(a+b)³ Cube</button>
            </div>

            <div style="margin-top: 8px;">
                <label style="font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between;">
                    <span>Dimension a = <strong>${a}</strong></span>
                    <span>Dimension b = <strong>${b}</strong></span>
                </label>
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <input type="range" id="slider-a" min="1" max="5" value="${a}" style="flex: 1;">
                    <input type="range" id="slider-b" min="1" max="5" value="${b}" style="flex: 1;">
                </div>
            </div>

            <div style="margin-top: 8px;">
                <label style="font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between;">
                    <span>Explode Blocks View:</span>
                    <strong>${Math.round(this._explode * 100)}%</strong>
                </label>
                <input type="range" id="slider-explode" min="0" max="1" step="0.05" value="${this._explode}" style="width: 100%; margin-top: 4px;">
            </div>

            <div class="calc-box">
                <strong>Identity Expansion:</strong><br/>
                <span style="font-family: monospace; color: #38bdf8; font-size: 11px;">${formula}</span>
            </div>
        `;
    }

    _bindUIEvents() {
        if (!this._uiCardEl) return;

        const btn2d = this._uiCardEl.querySelector('#btn-mode-2d');
        const btn3d = this._uiCardEl.querySelector('#btn-mode-3d');
        if (btn2d) btn2d.addEventListener('click', () => { this._mode = '2d'; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (btn3d) btn3d.addEventListener('click', () => { this._mode = '3d'; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });

        const slA = this._uiCardEl.querySelector('#slider-a');
        const slB = this._uiCardEl.querySelector('#slider-b');
        const slEx = this._uiCardEl.querySelector('#slider-explode');

        if (slA) slA.addEventListener('input', (e) => { this._a = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (slB) slB.addEventListener('input', (e) => { this._b = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (slEx) slEx.addEventListener('input', (e) => { this._explode = parseFloat(e.target.value); this._updateAllAnchors(); });
    }

    _unmountUI() {
        if (this._uiCardEl) {
            if (this._uiCardEl.parentNode) this._uiCardEl.parentNode.removeChild(this._uiCardEl);
            this._uiCardEl = null;
        }
    }

    _subscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;
        const onAnchorCreated = async ({ tagId, anchor }) => { if (this._isSupportedTag(tagId)) await this._attachToAnchor(tagId, anchor); };
        const onAnchorRemoved = ({ tagId }) => this._detachFromAnchor(tagId);

        bus.on('ANCHOR_CREATED', onAnchorCreated);
        bus.on('ANCHOR_REMOVED', onAnchorRemoved);

        this._listeners.push({ evt: 'ANCHOR_CREATED', fn: onAnchorCreated });
        this._listeners.push({ evt: 'ANCHOR_REMOVED', fn: onAnchorRemoved });
    }

    _unsubscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;
        for (const { evt, fn } of this._listeners) bus.off(evt, fn);
        this._listeners = [];
    }

    _isSupportedTag(tagId) { return [1, 2, 3, 4, 5, -1].includes(Number(tagId)); }

    _disposeObject(obj) {
        if (!obj) return;
        obj.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => m && m.dispose());
            }
        });
    }
}
