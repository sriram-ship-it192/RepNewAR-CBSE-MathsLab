import * as THREE from 'three';

const defaultLessonConfig = {
    id: "fraction_kits",
    title: "Fraction Kits & Circle Cutouts",
    category: "Fractions & Decimals",
    description: "Interactive AR visualization of NCERT physical fraction discs, equivalent fractions (1/2 = 2/4 = 3/6), sector angles, and fraction addition.",
    supportedMarkerIds: [1, 2, 3, 4, 5, -1],
    defaultDimensions: { radius: 0.08 }
};

export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        this._activeAnchors = new Map();
        this._selectedFraction = 4; // 1/4 default
        this._compareFraction = 8;  // compare with 1/8
        this._count = 2; // e.g. 2/4

        this._uiCardEl = null;
        this._listeners = [];
    }

    async initialize(context) {
        this._context = context;
        console.log('FractionKitsLesson: Initialized.');
    }

    getMetadata() {
        return this._config;
    }

    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('FractionKitsLesson: Activating...');

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
            fallbackGroup.name = 'fractions-fallback-anchor';
            fallbackGroup.position.set(0, 0, -0.3);
            this._context.scene.add(fallbackGroup);
            this._attachToAnchor(-1, fallbackGroup);
        }
    }

    async deactivate() {
        if (!this._active) return;
        console.log('FractionKitsLesson: Deactivating...');

        this._unmountUI();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        const fallback = this._context?.scene?.getObjectByName('fractions-fallback-anchor');
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
        console.log('FractionKitsLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Fraction Disc Mesh Construction
    // ------------------------------------------------------------------ //

    _buildFractionDiscs() {
        const group = new THREE.Group();
        group.name = 'fraction-discs-group';

        const radius = 0.08;
        const depth = 0.01;

        // Colors for sectors
        const palette = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899];

        // Disc 1: Selected fraction (e.g. 2/4)
        const disc1Group = new THREE.Group();
        disc1Group.position.set(-radius * 1.2, 0, 0);

        const denom = this._selectedFraction;
        const count = Math.min(this._count, denom);
        const sectorAngle = (Math.PI * 2) / denom;

        for (let i = 0; i < denom; i++) {
            const isFilled = i < count;
            const startAngle = i * sectorAngle;
            const mat = new THREE.MeshStandardMaterial({
                color: isFilled ? palette[i % palette.length] : 0x334155,
                transparent: true,
                opacity: isFilled ? 0.9 : 0.25,
                roughness: 0.3
            });

            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.arc(0, 0, radius, startAngle, startAngle + sectorAngle, false);
            shape.lineTo(0, 0);

            const extrudeSettings = { depth: depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.001, bevelThickness: 0.001 };
            const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geo.rotateX(-Math.PI / 2);

            const mesh = new THREE.Mesh(geo, mat);
            disc1Group.add(mesh);
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true })));
        }

        group.add(disc1Group);

        // Disc 2: Equivalent comparison disc (e.g. 4/8)
        const disc2Group = new THREE.Group();
        disc2Group.position.set(radius * 1.2, 0, 0);

        const compDenom = this._compareFraction;
        const compCount = Math.round((count / denom) * compDenom);
        const compSectorAngle = (Math.PI * 2) / compDenom;

        for (let i = 0; i < compDenom; i++) {
            const isFilled = i < compCount;
            const startAngle = i * compSectorAngle;
            const mat = new THREE.MeshStandardMaterial({
                color: isFilled ? 0x10b981 : 0x334155,
                transparent: true,
                opacity: isFilled ? 0.9 : 0.25,
                roughness: 0.3
            });

            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.arc(0, 0, radius, startAngle, startAngle + compSectorAngle, false);
            shape.lineTo(0, 0);

            const extrudeSettings = { depth: depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.001, bevelThickness: 0.001 };
            const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geo.rotateX(-Math.PI / 2);

            const mesh = new THREE.Mesh(geo, mat);
            disc2Group.add(mesh);
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true })));
        }

        group.add(disc2Group);

        return group;
    }

    // ------------------------------------------------------------------ //
    //  AR Anchoring & UI
    // ------------------------------------------------------------------ //

    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;
        this._detachFromAnchor(tagId);

        const discs = this._buildFractionDiscs();
        discs.name = `fraction-discs-${tagId}`;
        anchor.add(discs);
        this._activeAnchors.set(tagId, anchor);
    }

    _detachFromAnchor(tagId) {
        const anchor = this._activeAnchors.get(tagId);
        if (anchor) {
            const old = anchor.getObjectByName(`fraction-discs-${tagId}`);
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
                const old = anchor.getObjectByName(`fraction-discs-${tagId}`);
                if (old) {
                    anchor.remove(old);
                    this._disposeObject(old);
                }
                const newDiscs = this._buildFractionDiscs();
                newDiscs.name = `fraction-discs-${tagId}`;
                anchor.add(newDiscs);
            }
        }
    }

    _mountUI() {
        if (typeof document === 'undefined' || this._uiCardEl) return;

        if (!document.getElementById('fraction-styles')) {
            const style = document.createElement('style');
            style.id = 'fraction-styles';
            style.textContent = `
                #fraction-card {
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
                #fraction-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 15px;
                    color: #60a5fa;
                }
                #fraction-card select, #fraction-card input {
                    width: 100%;
                    margin-top: 4px;
                    padding: 6px;
                    background: #1e293b;
                    border: 1px solid #475569;
                    color: #fff;
                    border-radius: 6px;
                }
                .frac-box {
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
        this._uiCardEl.id = 'fraction-card';
        this._renderUIContent();
        document.body.appendChild(this._uiCardEl);

        this._bindUIEvents();
    }

    _renderUIContent() {
        if (!this._uiCardEl) return;

        const d1 = this._selectedFraction;
        const c1 = this._count;
        const d2 = this._compareFraction;
        const c2 = Math.round((c1 / d1) * d2);

        const pct = Math.round((c1 / d1) * 100);
        const angle = Math.round((c1 / d1) * 360);

        this._uiCardEl.innerHTML = `
            <h3>🍕 Fraction Kit & Equivalents</h3>

            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <div style="flex: 1;">
                    <label style="font-size: 11px; color: #94a3b8;">Fraction (Slices):</label>
                    <select id="select-denom">
                        <option value="2" ${d1 === 2 ? 'selected' : ''}>1/2 Discs</option>
                        <option value="3" ${d1 === 3 ? 'selected' : ''}>1/3 Discs</option>
                        <option value="4" ${d1 === 4 ? 'selected' : ''}>1/4 Discs</option>
                        <option value="6" ${d1 === 6 ? 'selected' : ''}>1/6 Discs</option>
                        <option value="8" ${d1 === 8 ? 'selected' : ''}>1/8 Discs</option>
                        <option value="12" ${d1 === 12 ? 'selected' : ''}>1/12 Discs</option>
                    </select>
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 11px; color: #94a3b8;">Compare With:</label>
                    <select id="select-compare">
                        <option value="4" ${d2 === 4 ? 'selected' : ''}>1/4 Discs</option>
                        <option value="6" ${d2 === 6 ? 'selected' : ''}>1/6 Discs</option>
                        <option value="8" ${d2 === 8 ? 'selected' : ''}>1/8 Discs</option>
                        <option value="12" ${d2 === 12 ? 'selected' : ''}>1/12 Discs</option>
                    </select>
                </div>
            </div>

            <div style="margin-top: 8px;">
                <label style="font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between;">
                    <span>Active Slices Count:</span>
                    <strong>${c1} / ${d1}</strong>
                </label>
                <input type="range" id="slider-count" min="1" max="${d1}" value="${c1}">
            </div>

            <div class="frac-box">
                <strong>Equivalent Fraction Check:</strong><br/>
                <span style="font-size: 14px; font-weight: bold; color: #38bdf8;">${c1}/${d1} = ${c2}/${d2} = ${pct}%</span><br/>
                <span style="color: #94a3b8; font-size: 11px;">Sector Angle: ${angle}° (${c1} × ${360 / d1}°)</span>
            </div>
        `;
    }

    _bindUIEvents() {
        if (!this._uiCardEl) return;

        const selD1 = this._uiCardEl.querySelector('#select-denom');
        const selD2 = this._uiCardEl.querySelector('#select-compare');
        const slCnt = this._uiCardEl.querySelector('#slider-count');

        if (selD1) selD1.addEventListener('change', (e) => { this._selectedFraction = parseInt(e.target.value); this._count = 1; this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (selD2) selD2.addEventListener('change', (e) => { this._compareFraction = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
        if (slCnt) slCnt.addEventListener('input', (e) => { this._count = parseInt(e.target.value); this._updateAllAnchors(); this._renderUIContent(); this._bindUIEvents(); });
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
