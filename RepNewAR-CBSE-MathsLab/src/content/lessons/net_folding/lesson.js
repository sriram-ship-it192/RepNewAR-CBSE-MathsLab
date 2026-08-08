import * as THREE from 'three';

const defaultLessonConfig = {
    id: "net_folding",
    title: "3D Net Folding & Unfolding (NCERT Activity)",
    category: "3D Geometry",
    description: "Interactive AR visualization demonstrating how 2D flat cardboard nets fold into 3D solids (Cube, Cuboid, Pyramids, Cylinder) with Euler's Formula (F + V - E = 2).",
    supportedMarkerIds: [1, 2, 3, 4, 5, 0, 42, -1],
    defaultDimensions: { size: 0.08 }
};

export class Lesson {
    constructor() {
        this._context = null;
        this._active = false;
        this._config = defaultLessonConfig;

        this._activeAnchors = new Map();
        this._currentShape = 'cube';
        this._foldProgress = 0.5; // 0 = Flat Net, 1 = Folded 3D Solid
        this._autoAnimate = true;
        this._animTime = 0;

        this._uiCardEl = null;
        this._listeners = [];
        this._hingeReferences = new Map(); // tagId -> array of hinge groups
    }

    async initialize(context) {
        this._context = context;
        console.log('NetFoldingLesson: Initialized.');
    }

    getMetadata() {
        return this._config;
    }

    async activate() {
        if (this._active) return;
        this._active = true;
        console.log('NetFoldingLesson: Activating...');

        this._mountUI();
        this._subscribeEvents();

        // Attach to existing camera anchors
        const existingAnchors = this._context?.anchorManager?.getAllAnchors() || [];
        for (const record of existingAnchors) {
            if (this._isSupportedTag(record.tagId)) {
                await this._attachToAnchor(record.tagId, record.anchor);
            }
        }

        // If no AR tag is detected yet, create a 3D fallback anchor directly in front of camera
        if (this._activeAnchors.size === 0 && this._context?.scene) {
            let fallbackGroup = this._context.scene.getObjectByName('net-folding-fallback-anchor');
            if (!fallbackGroup) {
                fallbackGroup = new THREE.Group();
                fallbackGroup.name = 'net-folding-fallback-anchor';
                fallbackGroup.position.set(0, -0.02, -0.35);
                fallbackGroup.rotation.x = 0.2; // Slight tilt for 3D visibility
                this._context.scene.add(fallbackGroup);
            }
            await this._attachToAnchor(-1, fallbackGroup);
        }
    }

    async deactivate() {
        if (!this._active) return;
        console.log('NetFoldingLesson: Deactivating...');

        this._unmountUI();
        this._unsubscribeEvents();
        this._detachFromAllAnchors();

        const fallback = this._context?.scene?.getObjectByName('net-folding-fallback-anchor');
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
        console.log('NetFoldingLesson: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  3D Hinged Net Construction (Cube, Cuboid, Pyramid, Cylinder)
    // ------------------------------------------------------------------ //

    _buildNetMesh(tagId, shape) {
        const group = new THREE.Group();
        group.name = `net-assembly-${tagId}`;

        const size = 0.07;
        const mat = new THREE.MeshStandardMaterial({
            color: 0x3b82f6,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.88,
            roughness: 0.25,
            metalness: 0.15
        });
        mat.renderOrder = 1;

        const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const hinges = [];

        if (shape === 'pyramid') {
            // Square Base
            const baseGeo = new THREE.PlaneGeometry(size, size);
            const baseMesh = new THREE.Mesh(baseGeo, mat);
            baseMesh.rotation.x = -Math.PI / 2;
            group.add(baseMesh);
            baseMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));

            const triHeight = size * 1.1;
            const triGeo = new THREE.ConeGeometry(size / Math.sqrt(2), triHeight, 3);
            triGeo.rotateX(-Math.PI / 2);

            const maxAngle = Math.atan(triHeight / (size / 2)) * 0.95;

            for (let i = 0; i < 4; i++) {
                const sideHinge = new THREE.Group();
                const angle = (i * Math.PI) / 2;
                sideHinge.rotation.y = angle;
                sideHinge.position.set(
                    (size / 2) * Math.sin(angle),
                    0,
                    (size / 2) * Math.cos(angle)
                );

                const triMesh = new THREE.Mesh(triGeo, mat);
                triMesh.position.set(0, 0, triHeight / 2);
                sideHinge.add(triMesh);
                triMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(triGeo), edgeMat));
                group.add(sideHinge);

                hinges.push({ group: sideHinge, axis: 'x', dir: 1, maxAngle: maxAngle });
            }
        } else {
            // Cube / Cuboid Net
            const baseGeo = new THREE.PlaneGeometry(size, size);
            const baseMesh = new THREE.Mesh(baseGeo, mat);
            baseMesh.rotation.x = -Math.PI / 2;
            group.add(baseMesh);
            baseMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));

            // 1. Front Hinge
            const frontHinge = new THREE.Group();
            frontHinge.position.set(0, 0, size / 2);
            const frontMesh = new THREE.Mesh(baseGeo, mat);
            frontMesh.position.set(0, 0, size / 2);
            frontHinge.add(frontMesh);
            frontMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));
            group.add(frontHinge);
            hinges.push({ group: frontHinge, axis: 'x', dir: 1, maxAngle: Math.PI / 2 });

            // 2. Back Hinge
            const backHinge = new THREE.Group();
            backHinge.position.set(0, 0, -size / 2);
            const backMesh = new THREE.Mesh(baseGeo, mat);
            backMesh.position.set(0, 0, -size / 2);
            backHinge.add(backMesh);
            backMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));
            group.add(backHinge);
            hinges.push({ group: backHinge, axis: 'x', dir: -1, maxAngle: Math.PI / 2 });

            // 3. Left Hinge
            const leftHinge = new THREE.Group();
            leftHinge.position.set(-size / 2, 0, 0);
            const leftMesh = new THREE.Mesh(baseGeo, mat);
            leftMesh.position.set(-size / 2, 0, 0);
            leftHinge.add(leftMesh);
            leftMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));
            group.add(leftHinge);
            hinges.push({ group: leftHinge, axis: 'z', dir: 1, maxAngle: Math.PI / 2 });

            // 4. Right Hinge
            const rightHinge = new THREE.Group();
            rightHinge.position.set(size / 2, 0, 0);
            const rightMesh = new THREE.Mesh(baseGeo, mat);
            rightMesh.position.set(size / 2, 0, 0);
            rightHinge.add(rightMesh);
            rightMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));
            group.add(rightHinge);
            hinges.push({ group: rightHinge, axis: 'z', dir: -1, maxAngle: Math.PI / 2 });

            // 5. Top Lid Hinge (Attached to Right Hinge)
            const topHinge = new THREE.Group();
            topHinge.position.set(size, 0, 0);
            const topMesh = new THREE.Mesh(baseGeo, mat);
            topMesh.position.set(size / 2, 0, 0);
            topHinge.add(topMesh);
            topMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo), edgeMat));
            rightHinge.add(topHinge);
            hinges.push({ group: topHinge, axis: 'z', dir: -1, maxAngle: Math.PI / 2 });
        }

        this._hingeReferences.set(tagId, hinges);

        // Attach 3D floating formula labels directly to the folding net in AR space
        const labels = this._create3DNetLabels(shape);
        group.add(labels);

        return group;
    }

    // ------------------------------------------------------------------ //
    //  3D Floating AR Formula Labels
    // ------------------------------------------------------------------ //

    _create3DNetLabels(shape) {
        const group = new THREE.Group();
        group.name = 'net-3d-formula-labels';

        const euler = this._calculateEuler(shape);

        const labels = [
            { text: `📐 3D Net Folding (${shape.toUpperCase()})`, position: [0, 0.14, 0], color: '#60a5fa' },
            { text: `Faces (F): ${euler.F}  |  Vertices (V): ${euler.V}  |  Edges (E): ${euler.E}`, position: [0, 0.10, 0], color: '#38bdf8' },
            { text: `Euler's Law: F + V - E = 2  (${euler.F} + ${euler.V} - ${euler.E} = 2)`, position: [0, -0.08, 0], color: '#fbbf24' },
            { text: 'Dynamic 3D Cardboard Folding Net', position: [0, -0.12, 0], color: '#f472b6' }
        ];

        for (const { text, position, color } of labels) {
            const sprite = this._makeLabelSprite(text, color);
            sprite.position.set(position[0], position[1], position[2]);
            group.add(sprite);
        }

        return group;
    }

    _makeLabelSprite(text, color) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = 34;
        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const padX = 16;
        const padY = 8;
        const w = Math.ceil(textWidth + padX * 2);
        const h = Math.ceil(fontSize + padY * 2);

        // 2x Super-sampling for high DPI text clarity
        canvas.width = w * 2;
        canvas.height = h * 2;
        ctx.scale(2, 2);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(1, 1, w - 2, h - 2, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(text, w / 2, h / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
        });

        const sprite = new THREE.Sprite(material);

        // Preserve aspect ratio so text is un-squished
        const aspect = w / h;
        const scaleY = 0.024;
        const scaleX = scaleY * aspect;
        sprite.scale.set(scaleX, scaleY, 1);

        return sprite;
    }

    // ------------------------------------------------------------------ //
    //  Interactive UI Controls & AR Anchoring
    // ------------------------------------------------------------------ //

    _mountUI() {
        if (typeof document === 'undefined' || this._uiCardEl) return;

        if (!document.getElementById('net-folding-control-styles')) {
            const style = document.createElement('style');
            style.id = 'net-folding-control-styles';
            style.textContent = `
                #net-folding-control-bar {
                    position: fixed;
                    bottom: 24px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.92);
                    border: 1px solid rgba(59, 130, 246, 0.6);
                    border-radius: 12px;
                    padding: 10px 18px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    color: #f8fafc;
                    font-family: system-ui, -apple-system, sans-serif;
                    z-index: 9999;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(10px);
                }
                .net-ctrl-btn {
                    background: #2563eb;
                    border: none;
                    border-radius: 6px;
                    color: #fff;
                    font-weight: 700;
                    padding: 8px 14px;
                    cursor: pointer;
                    font-size: 13px;
                }
                .net-ctrl-btn:hover { background: #1d4ed8; }
                .net-ctrl-select {
                    background: #1e293b;
                    border: 1px solid #475569;
                    color: #fff;
                    border-radius: 6px;
                    padding: 6px 10px;
                    font-size: 13px;
                }
            `;
            document.head.appendChild(style);
        }

        this._uiCardEl = document.createElement('div');
        this._uiCardEl.id = 'net-folding-control-bar';
        this._renderUIContent();
        document.body.appendChild(this._uiCardEl);

        this._bindUIEvents();
    }

    _renderUIContent() {
        if (!this._uiCardEl) return;

        this._uiCardEl.innerHTML = `
            <select class="net-ctrl-select" id="select-net-shape">
                <option value="cube" ${this._currentShape === 'cube' ? 'selected' : ''}>Cube Net</option>
                <option value="pyramid" ${this._currentShape === 'pyramid' ? 'selected' : ''}>Square Pyramid Net</option>
            </select>
            <button class="net-ctrl-btn" id="btn-toggle-anim">${this._autoAnimate ? '⏸️ Pause Auto-Fold' : '▶️ Auto-Fold'}</button>
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 12px; color: #94a3b8;">Fold:</span>
                <input type="range" id="slider-net-fold" min="0" max="1" step="0.01" value="${this._foldProgress}" style="width: 120px;">
                <span style="font-size: 12px; font-weight: 700; color: #38bdf8;" id="txt-fold-val">${Math.round(this._foldProgress * 100)}%</span>
            </div>
        `;
    }

    _bindUIEvents() {
        if (!this._uiCardEl) return;

        const selShape = this._uiCardEl.querySelector('#select-net-shape');
        const btnAnim = this._uiCardEl.querySelector('#btn-toggle-anim');
        const slFold = this._uiCardEl.querySelector('#slider-net-fold');

        if (selShape) {
            selShape.addEventListener('change', (e) => {
                this._currentShape = e.target.value;
                this._updateAllAnchors();
            });
        }

        if (btnAnim) {
            btnAnim.addEventListener('click', () => {
                this._autoAnimate = !this._autoAnimate;
                this._renderUIContent();
                this._bindUIEvents();
            });
        }

        if (slFold) {
            slFold.addEventListener('input', (e) => {
                this._autoAnimate = false;
                this._foldProgress = parseFloat(e.target.value);
                const txt = this._uiCardEl.querySelector('#txt-fold-val');
                if (txt) txt.textContent = `${Math.round(this._foldProgress * 100)}%`;
                this._updateHingeRotations(this._foldProgress);
            });
        }
    }

    _unmountUI() {
        if (this._uiCardEl) {
            if (this._uiCardEl.parentNode) this._uiCardEl.parentNode.removeChild(this._uiCardEl);
            this._uiCardEl = null;
        }
    }

    async _attachToAnchor(tagId, anchor) {
        if (!anchor) return;
        this._detachFromAnchor(tagId);

        const netMesh = this._buildNetMesh(tagId, this._currentShape);
        netMesh.scale.setScalar(1.5);
        anchor.add(netMesh);
        this._activeAnchors.set(tagId, anchor);
        this._updateHingeRotations(this._foldProgress);
    }

    _detachFromAnchor(tagId) {
        const anchor = this._activeAnchors.get(tagId);
        if (anchor) {
            const old = anchor.getObjectByName(`net-assembly-${tagId}`);
            if (old) {
                anchor.remove(old);
                this._disposeObject(old);
            }
            this._activeAnchors.delete(tagId);
            this._hingeReferences.delete(tagId);
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
                this._attachToAnchor(tagId, anchor);
            }
        }
    }

    _updateHingeRotations(progress) {
        for (const hinges of this._hingeReferences.values()) {
            if (!hinges) continue;
            for (const item of hinges) {
                const angle = item.maxAngle * progress * item.dir;
                if (item.axis === 'x') {
                    item.group.rotation.x = angle;
                } else if (item.axis === 'z') {
                    item.group.rotation.z = angle;
                }
            }
        }
    }

    _calculateEuler(shape) {
        switch (shape) {
            case 'cube': return { F: 6, V: 8, E: 12 };
            case 'pyramid': return { F: 5, V: 5, E: 8 };
            default: return { F: 6, V: 8, E: 12 };
        }
    }

    _subscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;

        const onAnchorCreated = async ({ tagId, anchor }) => {
            if (this._isSupportedTag(tagId)) await this._attachToAnchor(tagId, anchor);
        };
        const onAnchorRemoved = ({ tagId }) => this._detachFromAnchor(tagId);

        const onRenderFrame = (data) => {
            if (!this._active) return;

            if (this._autoAnimate) {
                const dt = (data?.deltaTime || 16.6) / 1000;
                this._animTime += dt * 1.2;
                this._foldProgress = (Math.sin(this._animTime) + 1) / 2;

                const slider = this._uiCardEl?.querySelector('#slider-net-fold');
                if (slider) slider.value = this._foldProgress;
                const txt = this._uiCardEl?.querySelector('#txt-fold-val');
                if (txt) txt.textContent = `${Math.round(this._foldProgress * 100)}%`;

                this._updateHingeRotations(this._foldProgress);
            }
        };

        bus.on('ANCHOR_CREATED', onAnchorCreated);
        bus.on('ANCHOR_REMOVED', onAnchorRemoved);
        bus.on('RENDER_FRAME', onRenderFrame);

        this._listeners.push({ evt: 'ANCHOR_CREATED', fn: onAnchorCreated });
        this._listeners.push({ evt: 'ANCHOR_REMOVED', fn: onAnchorRemoved });
        this._listeners.push({ evt: 'RENDER_FRAME', fn: onRenderFrame });
    }

    _unsubscribeEvents() {
        if (!this._context?.eventBus) return;
        const bus = this._context.eventBus;
        for (const { evt, fn } of this._listeners) bus.off(evt, fn);
        this._listeners = [];
    }

    _isSupportedTag(tagId) {
        return [1, 2, 3, 4, 5, 0, 42, -1].includes(Number(tagId));
    }

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
