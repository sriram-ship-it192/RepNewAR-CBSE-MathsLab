import * as THREE from 'three';

const defaultLessonConfig = {
    id: "symmetry_reflection",
    title: "Symmetry & Reflection (NCERT Activity)",
    category: "Geometry & Patterns",
    description: "AR visualization of 2D line symmetry, 3D reflection planes, mirror images, and order of rotational symmetry (Square, Hexagon, Circle).",
    supportedMarkerIds: [1, 2, 3, 4, 5, -1],
    defaultDimensions: { size: 0.1 }
};

export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        this._activeAnchors = new Map();
        this._shape = 'square'; // 'square', 'triangle', 'hexagon', 'circle'
        this._rotAngle = 0; // rotation angle in degrees
        this._showReflection = true;

        this._uiCardEl = null;
        this._listeners = [];
    }

    async initialize(context) {
        this._context = context;
        console.log('SymmetryReflectionLesson: Initialized.');
    }

    getMetadata() {
        return this._config;
    }

    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('SymmetryReflectionLesson: Activating...');

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
            fallbackGroup.name = 'symmetry-fallback-anchor';
            fallbackGroup.position.set(0, 0, -0.3);
            this._context.scene.add(fallbackGroup);
            this._attachToAnchor(-1, fallbackGroup);
        }
    }

    async deactivate() {
        if (!this._active) return;
        console.log('SymmetryReflectionLesson: Deactivating...');

        this._unmountUI();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        const fallback = this._context?.scene?.getObjectByName('symmetry-fallback-anchor');
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
        console.log('SymmetryReflectionLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Mesh & Symmetry Line Construction
    // ------------------------------------------------------------------ //

    _buildSymmetryMesh() {
        const group = new THREE.Group();
        group.name = 'symmetry-group';

        const size = 0.08;

        // 1. Primary Mesh
        let shapeGeo;
        switch (this._shape) {
            case 'triangle':
                shapeGeo = new THREE.ConeGeometry(size, 0.005, 3);
                break;
            case 'square':
                shapeGeo = new THREE.BoxGeometry(size, 0.005, size);
                break;
            case 'hexagon':
                shapeGeo = new THREE.CylinderGeometry(size, size, 0.005, 6);
                break;
            case 'circle':
                shapeGeo = new THREE.CylinderGeometry(size, size, 0.005, 32);
                break;
            default:
                shapeGeo = new THREE.BoxGeometry(size, 0.005, size);
                break;
        }

        const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85, roughness: 0.3 });
        const mesh = new THREE.Mesh(shapeGeo, mat);
        mesh.rotation.y = (this._rotAngle * Math.PI) / 180;
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(shapeGeo), new THREE.LineBasicMaterial({ color: 0x60a5fa })));
        group.add(mesh);

        // 2. Vertical Mirror Plane (Symmetry Axis / Plane)
        const planeGeo = new THREE.PlaneGeometry(size * 2.2, size * 1.5);
        const planeMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const planeMesh = new THREE.Mesh(planeGeo, planeMat);
        planeMesh.rotation.y = Math.PI / 2;
        group.add(planeMesh);

        // Red Line of symmetry
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -size, 0), new THREE.Vector3(0, size, 0)]);
        group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 })));

        // 3. Mirror Reflection Ghosting
        if (this._showReflection) {
            const ghostMat = new THREE.MeshStandardMaterial({ color: 0x10b981, transparent: true, opacity: 0.4, roughness: 0.3 });
            const ghostMesh = new THREE.Mesh(shapeGeo, ghostMat);
            ghostMesh.position.set(-mesh.position.x, mesh.position.y, mesh.position.z);
            ghostMesh.rotation.y = -mesh.rotation.y;
            group.add(ghostMesh);
        }

        return group;
    }

    // ------------------------------------------------------------------ //
    //  AR Anchoring & UI
    // ------------------------------------------------------------------ //

    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;
        this._detachFromAnchor(tagId);

        const symmetryMesh = this._buildSymmetryMesh();
        symmetryMesh.name = `symmetry-${tagId}`;
        anchor.add(symmetryMesh);
        this._activeAnchors.set(tagId, anchor);
    }

    _detachFromAnchor(tagId) {
        const anchor = this._activeAnchors.get(tagId);
        if (anchor) {
            const old = anchor.getObjectByName(`symmetry-${tagId}`);
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
                const old = anchor.getObjectByName(`symmetry-${tagId}`);
                if (old) {
                    anchor.remove(old);
                    this._disposeObject(old);
                }
                const newMesh = this._buildSymmetryMesh();
                newMesh.name = `symmetry-${tagId}`;
                anchor.add(newMesh);
            }
        }
    }

    _mountUI() {
        if (typeof document === 'undefined' || this._uiCardEl) return;

        if (!document.getElementById('symmetry-styles')) {
            const style = document.createElement('style');
            style.id = 'symmetry-styles';
            style.textContent = `
                #symmetry-card {
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
                #symmetry-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 15px;
                    color: #60a5fa;
                }
                #symmetry-card select, #symmetry-card input {
                    width: 100%;
                    margin-top: 4px;
                    padding: 6px;
                    background: #1e293b;
                    border: 1px solid #475569;
                    color: #fff;
                    border-radius: 6px;
                }
                .symm-info-box {
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
        this._uiCardEl.id = 'symmetry-card';
        this._renderUIContent();
        document.body.appendChild(this._uiCardEl);

        this._bindUIEvents();
    }

    _renderUIContent() {
        if (!this._uiCardEl) return;

        const info = this._getSymmetryInfo(this._shape);

        this._uiCardEl.innerHTML = `
            <h3>🦋 Symmetry & Reflection</h3>

            <label style="font-size: 11px; color: #94a3b8;">Select Geometric Shape:</label>
            <select id="select-symm-shape">
                <option value="square" ${this._shape === 'square' ? 'selected' : ''}>Square (4 Lines of Symmetry)</option>
                <option value="triangle" ${this._shape === 'triangle' ? 'selected' : ''}>Equilateral Triangle (3 Lines)</option>
                <option value="hexagon" ${this._shape === 'hexagon' ? 'selected' : ''}>Regular Hexagon (6 Lines)</option>
                <option value="circle" ${this._shape === 'circle' ? 'selected' : ''}>Circle (Infinite Lines)</option>
            </select>

            <div style="margin-top: 8px;">
                <label style="font-size: 12px; color: #94a3b8; display: flex; justify-space: space-between;">
                    <span>Rotate Shape:</span>
                    <strong style="color: #60a5fa;">${this._rotAngle}°</strong>
                </label>
                <input type="range" id="slider-symm-rot" min="0" max="360" value="${this._rotAngle}" style="width: 100%; margin-top: 4px;">
            </div>

            <div class="symm-info-box">
                <strong>Lines of Symmetry: <span style="color: #38bdf8;">${info.lines}</span></strong><br/>
                <strong>Rotational Order: <span style="color: #10b981;">${info.order}</span></strong> (${info.angle})
            </div>
        `;
    }

    _bindUIEvents() {
        if (!this._uiCardEl) return;

        const selShape = this._uiCardEl.querySelector('#select-symm-shape');
        const slRot = this._uiCardEl.querySelector('#slider-symm-rot');

        if (selShape) selShape.addEventListener('change', (e) => { this._shape = e.target.value; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (slRot) slRot.addEventListener('input', (e) => { this._rotAngle = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); });
    }

    _getSymmetryInfo(s) {
        switch (s) {
            case 'square': return { lines: '4 (2 diagonals, 2 mid-lines)', order: 'Order 4', angle: '90° step' };
            case 'triangle': return { lines: '3 (medians)', order: 'Order 3', angle: '120° step' };
            case 'hexagon': return { lines: '6', order: 'Order 6', angle: '60° step' };
            case 'circle': return { lines: 'Infinite (any diameter)', order: 'Infinite Order', angle: 'Any angle' };
            default: return { lines: '4', order: 'Order 4', angle: '90° step' };
        }
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
