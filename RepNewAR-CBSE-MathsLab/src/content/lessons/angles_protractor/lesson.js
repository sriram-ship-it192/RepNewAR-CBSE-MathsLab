import * as THREE from 'three';

const defaultLessonConfig = {
    id: "angles_protractor",
    title: "Angles & Protractor Tool",
    category: "Geometry & Measurement",
    description: "AR protractor tool demonstrating angle measurement (0°-360°), angle types (Acute, Right, Obtuse, Reflex), and Complementary / Supplementary angle pairs.",
    supportedMarkerIds: [1, 2, 3, 4, 5, -1],
    defaultDimensions: { radius: 0.1 }
};

export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        this._activeAnchors = new Map();
        this._angle = 60; // 60 degrees default
        this._mode = 'types'; // 'types', 'complementary', 'supplementary'

        this._uiCardEl = null;
        this._listeners = [];
    }

    async initialize(context) {
        this._context = context;
        console.log('AnglesProtractorLesson: Initialized.');
    }

    getMetadata() {
        return this._config;
    }

    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('AnglesProtractorLesson: Activating...');

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
            fallbackGroup.name = 'angles-fallback-anchor';
            fallbackGroup.position.set(0, 0, -0.3);
            this._context.scene.add(fallbackGroup);
            this._attachToAnchor(-1, fallbackGroup);
        }
    }

    async deactivate() {
        if (!this._active) return;
        console.log('AnglesProtractorLesson: Deactivating...');

        this._unmountUI();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        const fallback = this._context?.scene?.getObjectByName('angles-fallback-anchor');
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
        console.log('AnglesProtractorLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Protractor Mesh & Ray Construction
    // ------------------------------------------------------------------ //

    _buildProtractorMesh() {
        const group = new THREE.Group();
        group.name = 'protractor-group';

        const radius = 0.1;
        const radAngle = (this._angle * Math.PI) / 180;

        // 1. Semi-transparent protractor disc
        const discGeo = new THREE.RingGeometry(0.02, radius, 64, 1, 0, Math.PI);
        const discMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
        const discMesh = new THREE.Mesh(discGeo, discMat);
        discMesh.rotation.x = -Math.PI / 2;
        group.add(discMesh);

        // 2. Outer ring border
        const ringBorder = new THREE.LineLoop(new THREE.EdgesGeometry(discGeo), new THREE.LineBasicMaterial({ color: 0x60a5fa }));
        discMesh.add(ringBorder);

        // 3. Base Ray (0 degrees) along +X
        const rayMat0 = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 });
        const rayGeo0 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(radius * 1.15, 0, 0)]);
        group.add(new THREE.Line(rayGeo0, rayMat0));

        // 4. Measured Ray (Angle theta)
        const rayMatTheta = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3 });
        const rayGeoTheta = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(radius * 1.15 * Math.cos(radAngle), 0, -radius * 1.15 * Math.sin(radAngle))
        ]);
        group.add(new THREE.Line(rayGeoTheta, rayMatTheta));

        // 5. Filled Arc sector for angle
        const arcShape = new THREE.Shape();
        arcShape.moveTo(0, 0);
        arcShape.arc(0, 0, radius * 0.7, 0, radAngle, false);
        arcShape.lineTo(0, 0);
        const arcGeo = new THREE.ShapeGeometry(arcShape);
        arcGeo.rotateX(-Math.PI / 2);
        const arcMesh = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
        group.add(arcMesh);

        // Complementary / Supplementary second ray if in special mode
        if (this._mode === 'complementary' || this._mode === 'supplementary') {
            const targetTotal = this._mode === 'complementary' ? 90 : 180;
            const remainingRad = (targetTotal * Math.PI) / 180;

            const remRayGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(radius * 1.15 * Math.cos(remainingRad), 0, -radius * 1.15 * Math.sin(remainingRad))
            ]);
            group.add(new THREE.Line(remRayGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 })));
        }

        return group;
    }

    // ------------------------------------------------------------------ //
    //  AR Anchoring & UI
    // ------------------------------------------------------------------ //

    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;
        this._detachFromAnchor(tagId);

        const protractor = this._buildProtractorMesh();
        protractor.name = `protractor-${tagId}`;
        anchor.add(protractor);
        this._activeAnchors.set(tagId, anchor);
    }

    _detachFromAnchor(tagId) {
        const anchor = this._activeAnchors.get(tagId);
        if (anchor) {
            const old = anchor.getObjectByName(`protractor-${tagId}`);
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
                const old = anchor.getObjectByName(`protractor-${tagId}`);
                if (old) {
                    anchor.remove(old);
                    this._disposeObject(old);
                }
                const newMesh = this._buildProtractorMesh();
                newMesh.name = `protractor-${tagId}`;
                anchor.add(newMesh);
            }
        }
    }

    _mountUI() {
        if (typeof document === 'undefined' || this._uiCardEl) return;

        if (!document.getElementById('angles-styles')) {
            const style = document.createElement('style');
            style.id = 'angles-styles';
            style.textContent = `
                #angles-card {
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
                #angles-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 15px;
                    color: #60a5fa;
                }
                .angle-row {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                }
                .angle-btn {
                    flex: 1;
                    padding: 6px;
                    background: #1e293b;
                    border: 1px solid #475569;
                    color: #fff;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 11px;
                }
                .angle-btn.active {
                    background: #2563eb;
                    border-color: #60a5fa;
                }
                .angle-info-box {
                    background: rgba(30, 41, 59, 0.8);
                    border-left: 3px solid #10b981;
                    padding: 8px;
                    margin-top: 10px;
                    font-size: 12px;
                    border-radius: 4px;
                }
            `;
            document.head.appendChild(style);
        }

        this._uiCardEl = document.createElement('div');
        this._uiCardEl.id = 'angles-card';
        this._renderUIContent();
        document.body.appendChild(this._uiCardEl);

        this._bindUIEvents();
    }

    _renderUIContent() {
        if (!this._uiCardEl) return;

        const a = this._angle;
        const type = this._classifyAngle(a);

        let pairText = '';
        if (this._mode === 'complementary') {
            const comp = 90 - a;
            pairText = `Complementary Pair: ${a}° + ${comp}° = 90°`;
        } else if (this._mode === 'supplementary') {
            const supp = 180 - a;
            pairText = `Supplementary Pair: ${a}° + ${supp}° = 180°`;
        }

        this._uiCardEl.innerHTML = `
            <h3>📐 Interactive AR Protractor</h3>

            <div class="angle-row">
                <button class="angle-btn ${this._mode === 'types' ? 'active' : ''}" id="btn-ang-types">Angle Types</button>
                <button class="angle-btn ${this._mode === 'complementary' ? 'active' : ''}" id="btn-ang-comp">Complementary (90°)</button>
                <button class="angle-btn ${this._mode === 'supplementary' ? 'active' : ''}" id="btn-ang-supp">Supplementary (180°)</button>
            </div>

            <div style="margin-top: 8px;">
                <label style="font-size: 12px; color: #94a3b8; display: flex; justify-space: space-between;">
                    <span>Measured Angle θ:</span>
                    <strong style="color: #10b981; font-size: 14px;">${a}°</strong>
                </label>
                <input type="range" id="slider-angle" min="0" max="${this._mode === 'complementary' ? 90 : 180}" value="${a}" style="width: 100%; margin-top: 4px;">
            </div>

            <div class="angle-info-box">
                <strong>Classification: <span style="color: #60a5fa;">${type}</span></strong><br/>
                ${pairText ? `<span style="color: #f59e0b;">${pairText}</span>` : `<span style="color: #94a3b8; font-size: 11px;">Use slider to rotate angle ray dynamically.</span>`}
            </div>
        `;
    }

    _bindUIEvents() {
        if (!this._uiCardEl) return;

        const bTypes = this._uiCardEl.querySelector('#btn-ang-types');
        const bComp = this._uiCardEl.querySelector('#btn-ang-comp');
        const bSupp = this._uiCardEl.querySelector('#btn-ang-supp');
        const slAngle = this._uiCardEl.querySelector('#slider-angle');

        if (bTypes) bTypes.addEventListener('click', () => { this._mode = 'types'; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (bComp) bComp.addEventListener('click', () => { this._mode = 'complementary'; if (this._angle > 90) this._angle = 45; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (bSupp) bSupp.addEventListener('click', () => { this._mode = 'supplementary'; if (this._angle > 180) this._angle = 120; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (slAngle) slAngle.addEventListener('input', (e) => { this._angle = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
    }

    _classifyAngle(deg) {
        if (deg === 0) return "Zero Angle (0°)";
        if (deg < 90) return "Acute Angle (< 90°)";
        if (deg === 90) return "Right Angle (90°)";
        if (deg < 180) return "Obtuse Angle (90° - 180°)";
        if (deg === 180) return "Straight Angle (180°)";
        return "Reflex Angle (> 180°)";
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
