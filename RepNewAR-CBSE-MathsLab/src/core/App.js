/**
 * App.js - Main Application Entry Point
 *
 * Responsibility:
 * - Initializes all core modules and managers.
 * - Sets up the global EventBus and StateManager.
 * - Wires UI components (StartScreen), tracking components (CameraFeed,
 *   AprilTagDetector, PoseFilter, TrackerManager), and rendering components
 *   (SceneManager) into the initialization flow.
 * - Starts the application lifecycle.
 *
 * Note: This module orchestrates the application but does not contain
 * business logic, tracking logic, or rendering logic.
 */

import { EventBus } from './EventBus.js';
import { StateManager } from './StateManager.js';
import { CameraFeed } from '../tracking/CameraFeed.js';
import { AprilTagDetector } from '../tracking/AprilTagDetector.js';
import { PoseFilter } from '../tracking/PoseFilter.js';
import { TrackerManager } from '../tracking/TrackerManager.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { AnchorManager } from '../rendering/AnchorManager.js';
import { ObjectLoader } from '../rendering/ObjectLoader.js';
import { Lighting } from '../rendering/Lighting.js';
import { DebugPanel } from '../debug/DebugPanel.js';
import { InteractionSystem } from '../content/InteractionSystem.js';
import { LessonManager } from '../content/LessonManager.js';
import { LessonBrowser } from '../ui/LessonBrowser.js';
import { StartScreen } from '../ui/StartScreen.js';
import { TeacherConsole } from '../ui/TeacherConsole.js';
import * as THREE from 'three';

class App {
    constructor() {
        this.eventBus = new EventBus();
        this.stateManager = new StateManager(this.eventBus);

        this.cameraFeed = new CameraFeed(this.eventBus, this.stateManager);

        this.apriltagDetector = new AprilTagDetector(
            this.eventBus,
            this.stateManager,
            this.cameraFeed.getVideoElement(),
        );

        this.poseFilter = new PoseFilter(this.eventBus);

        this.trackerManager = new TrackerManager(this.eventBus);

        this.sceneManager = new SceneManager(this.eventBus);

        this.anchorManager = new AnchorManager(this.eventBus);

        this.objectLoader = new ObjectLoader(this.eventBus);

        this.interactionSystem = new InteractionSystem(this.eventBus);

        this.lessonManager = new LessonManager(this.eventBus);
        this.lessonBrowser = new LessonBrowser(this.eventBus, this.lessonManager);

        this.debugPanel = new DebugPanel(this.eventBus, { enabled: true, visible: false });

        this.startScreen = new StartScreen(this.eventBus);
        this.teacherConsole = new TeacherConsole(this.eventBus, this);

        this._bindLifecycleListeners();

        this.start();
    }

    start() {
        this.stateManager.setState('idle');

        const container = document.getElementById('ar-canvas-container');
        if (container) {
            this.sceneManager.initialize(container);
            this.sceneManager.start();
        }

        console.log('AR Educational Platform initialized.');
    }

    _bindLifecycleListeners() {
        this.eventBus.on('CAMERA_READY', async (data) => {
            console.log('App: Camera ready.', data.label);

            const video = this.cameraFeed.getVideoElement();
            const width = video.videoWidth || 1280;
            const height = video.videoHeight || 720;

            // Compute camera intrinsics and match Three.js perspective to real webcam
            // Typical webcam vertical FOV is ~50-55°.
            const fy = height * 0.95;
            const fx = fy;
            const cameraParams = {
                fx,
                fy,
                cx: width / 2,
                cy: height / 2,
            };

            // Set Three.js camera FOV to match the real webcam's vertical FOV
            const vfov = 2 * Math.atan2(height / 2, fy) * (180 / Math.PI);
            this.sceneManager.setCameraFov(vfov);
            console.log(`App: Camera FOV set to ${vfov.toFixed(1)}° (${width}x${height})`);

            if (!this.apriltagDetector._initialized) {
                try {
                    await this.apriltagDetector.initialize(cameraParams);
                } catch (err) {
                    console.error('App: Failed to initialize AprilTagDetector:', err);
                }
            }

            this.apriltagDetector.start();
        });

        this.eventBus.on('CAMERA_SWITCHED', (data) => {
            console.log('App: Camera switched to', data.label);
        });

        this.eventBus.on('CAMERA_STOPPED', () => {
            console.log('App: Camera stopped.');
            this.apriltagDetector.stop();
        });

        this.eventBus.on('CAMERA_ERROR', (data) => {
            console.error('App: Camera error.', data.type, data.error?.message);
        });

        this.eventBus.on('CAMERA_DISCONNECTED', (data) => {
            console.warn('App: Camera disconnected.', data.deviceId);
        });

        this.eventBus.on('TAG_DETECTED', (data) => {
            console.log('App: Tag detected — ID:', data.tagId, 'confidence:', data.confidence?.toFixed(3));
        });

        this.eventBus.on('TAG_UPDATED', (data) => {
            if (data.age % 60 === 0) {
                console.log('App: Tag updated — ID:', data.tagId, 'age:', data.age);
            }
        });

        this.eventBus.on('TAG_LOST', (data) => {
            console.log('App: Tag lost — ID:', data.tagId);
        });

        this.eventBus.on('TRACKING_STARTED', () => {
            console.log('App: Tracking started.');
        });

        this.eventBus.on('TRACKING_STOPPED', () => {
            console.log('App: Tracking stopped.');
        });

        this.eventBus.on('TRACKING_ERROR', (data) => {
            console.error('App: Tracking error.', data.error?.message);
        });

        this.eventBus.on('OBJECT_ADDED', (data) => {
            console.log('App: Tracked object registered — Tag ID:', data.tagId);
        });

        this.eventBus.on('OBJECT_LOST', (data) => {
            console.log('App: Tracked object lost — Tag ID:', data.tagId, 'reason:', data.reason);
            if (data.reason === 'lost') {
                this.trackerManager.unregister(data.tagId);
            }
        });

        this.eventBus.on('OBJECT_REMOVED', (data) => {
            console.log('App: Tracked object removed — Tag ID:', data.tagId);
        });

        this.eventBus.on('ANCHOR_CREATED', async ({ tagId, anchor }) => {
            console.log(`App: Anchor created — Tag ID ${tagId}`);
            const currentLesson = this.lessonManager?.getCurrentLesson();
            if (!currentLesson || !currentLesson.active) {
                this._attachShapeToAnchor(tagId, anchor);
            }
        });

        this.eventBus.on('ANCHOR_REMOVED', ({ tagId }) => {
            console.log(`App: Anchor removed for Tag ID ${tagId}`);
        });

        this.eventBus.on('SCENE_READY', async (data) => {
            console.log('App: Scene ready —', data.width + 'x' + data.height);
            this.anchorManager.initialize(data.scene);
            this.objectLoader.initialize(data.renderer);

            this.interactionSystem.initialize({
                scene: data.scene,
                camera: data.camera,
                renderer: data.renderer,
                eventBus: this.eventBus,
                trackerManager: this.trackerManager,
                anchorManager: this.anchorManager,
            });
            this.interactionSystem.activate();

            this.lessonManager.initialize({
                scene: data.scene,
                camera: data.camera,
                renderer: data.renderer,
                eventBus: this.eventBus,
                trackerManager: this.trackerManager,
                anchorManager: this.anchorManager,
                objectLoader: this.objectLoader,
                debugPanel: this.debugPanel,
            });
            console.log("App: Ready for multi-shape 3D WebAR tracking.");

            // Build NCERT Educational Activity Selector Bar
            this._buildShapeSelectorUI();

            // Default to the first CBSE physical-kit lesson so the production catalog is immediately ready
            try {
                await this.lessonManager.activateLesson('fraction_lab_3_5');
            } catch (e) {
                console.warn('App: Initial lesson auto-activation fallback:', e);
            }

            const lighting = new Lighting(data.scene);
            lighting.init();
        });

        // ── Expose app for DevTools inspection ──
        window.__app = this;

        this.eventBus.on('RENDER_STARTED', () => {
            console.log('App: Render loop started.');
        });

        this.eventBus.on('RENDER_STOPPED', () => {
            console.log('App: Render loop stopped.');
        });

        this.eventBus.on('RENDER_FRAME', () => {
            this.trackerManager.update();
        });
    }

    /**
     * Creates a standalone holographic cube group with cyan glass material,
     * glowing edge wireframe, and red corner spheres (8 vertices).
     *
     * @param {THREE.BoxGeometry} geometry
     * @returns {THREE.Group}
     * @private
     */
    _createHolographicCube(geometry) {
        const group = new THREE.Group();
        group.name = 'holographic-cube';

        geometry.computeBoundingBox();

        const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.65,
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 0.3,
            clearcoatRoughness: 0.25,
            envMapIntensity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        holoMat.renderOrder = 1;

        const mesh = new THREE.Mesh(geometry, holoMat);
        group.add(mesh);

        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(geometry);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        // Red spheres at each of the 8 bounding-box corners
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

    /**
     * Creates a standalone holographic tetrahedron (4-sided triangular pyramid)
     * with cyan glass material, glowing edge wireframe, and red vertex spheres.
     * Used as the instant-visibility model when an AprilTag is detected.
     *
     * @param {number} radius - Radius of the TetrahedronGeometry.
     * @returns {THREE.Group}
     * @private
     */
    _createHolographicTetrahedron(radius) {
        const group = new THREE.Group();
        group.name = 'holographic-tetrahedron';

        const geo = new THREE.TetrahedronGeometry(radius);

        const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.65,
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 0.3,
            clearcoatRoughness: 0.25,
            envMapIntensity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        holoMat.renderOrder = 1;

        const mesh = new THREE.Mesh(geo, holoMat);
        group.add(mesh);

        // Cyan edge wireframe
        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(geo);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        // Red spheres at each of the 4 vertices (from geometry position attribute)
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
        sphereMat.depthWrite = false;
        sphereMat.renderOrder = 3;

        const sphereGeo = new THREE.SphereGeometry(0.005, 12, 12);
        const posAttr = geo.getAttribute('position');
        const seen = new Set();
        for (let i = 0; i < posAttr.count; i++) {
            const key = `${posAttr.getX(i).toFixed(4)},${posAttr.getY(i).toFixed(4)},${posAttr.getZ(i).toFixed(4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            sphere.position.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            mesh.add(sphere);
        }

        return group;
    }

    /**
     * Creates a generic 3D holographic shape with physical cyan glass material,
     * glowing cyan edge wireframe, and red vertex spheres.
     *
     * @param {THREE.BufferGeometry} geometry
     * @param {string} shapeName
     * @returns {THREE.Group}
     * @private
     */
    _createHolographicShape(geometry, shapeName = 'shape') {
        const group = new THREE.Group();
        group.name = `holographic-${shapeName}`;

        geometry.computeBoundingBox();

        const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.65,
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 0.3,
            clearcoatRoughness: 0.25,
            envMapIntensity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        holoMat.renderOrder = 1;

        const mesh = new THREE.Mesh(geometry, holoMat);
        group.add(mesh);

        const edgeMat = new THREE.LineBasicMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.9,
        });
        edgeMat.depthWrite = false;
        edgeMat.renderOrder = 2;

        const edges = new THREE.EdgesGeometry(geometry);
        const wireframe = new THREE.LineSegments(edges, edgeMat);
        mesh.add(wireframe);

        // Accent spheres at geometry vertices
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
        sphereMat.depthWrite = false;
        sphereMat.renderOrder = 3;
        const sphereGeo = new THREE.SphereGeometry(0.004, 10, 10);

        const posAttr = geometry.getAttribute('position');
        if (posAttr && posAttr.count <= 60) {
            const seen = new Set();
            for (let i = 0; i < posAttr.count; i++) {
                const key = `${posAttr.getX(i).toFixed(3)},${posAttr.getY(i).toFixed(3)},${posAttr.getZ(i).toFixed(3)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const sphere = new THREE.Mesh(sphereGeo, sphereMat);
                sphere.position.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                mesh.add(sphere);
            }
        }

        return group;
    }

    /**
     * Attaches a 3D Holographic shape to an anchor.
     * Uses overrideShapeId if specified, otherwise maps from tagId.
     *
     * @param {number} tagId
     * @param {THREE.Object3D} anchor
     * @param {number|null} [overrideShapeId=null]
     * @private
     */
    _attachShapeToAnchor(tagId, anchor, overrideShapeId = null) {
        if (!anchor) return;

        const id = overrideShapeId !== null && overrideShapeId !== undefined
            ? Number(overrideShapeId)
            : Number(tagId);

        while (anchor.children.length > 0) {
            const child = anchor.children[0];
            anchor.remove(child);
        }

        let shape = null;
        switch (id) {
            case 0:
            case 42:
            case 99:
                shape = this._createHolographicShape(new THREE.TetrahedronGeometry(0.08), 'tetrahedron');
                break;
            case 1:
                shape = this._createHolographicShape(new THREE.BoxGeometry(0.1, 0.1, 0.1), 'cube');
                break;
            case 2:
                shape = this._createHolographicShape(new THREE.SphereGeometry(0.065, 24, 24), 'sphere');
                break;
            case 3:
                shape = this._createHolographicShape(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 24), 'cylinder');
                break;
            case 4:
                shape = this._createHolographicShape(new THREE.ConeGeometry(0.065, 0.11, 24), 'cone');
                break;
            case 5:
                shape = this._createHolographicShape(new THREE.TorusGeometry(0.06, 0.022, 16, 32), 'torus');
                break;
            case 6:
                shape = this._createHolographicShape(new THREE.OctahedronGeometry(0.075), 'octahedron');
                break;
            case 7:
                shape = this._createHolographicShape(new THREE.DodecahedronGeometry(0.07), 'dodecahedron');
                break;
            case 8:
                shape = this._createHolographicShape(new THREE.IcosahedronGeometry(0.07), 'icosahedron');
                break;
            case 9:
                shape = this._createHolographicShape(new THREE.TorusKnotGeometry(0.045, 0.015, 64, 16), 'torusknot');
                break;
            case -1:
                shape = this._createHolographicShape(new THREE.BoxGeometry(0.1, 0.1, 0.1), 'fused-cube');
                break;
            default:
                shape = this._createHolographicShape(new THREE.TetrahedronGeometry(0.08), 'fallback-tetra');
                break;
        }

        shape.name = `shape-model-${id}`;
        shape.scale.setScalar(1.6);
        shape.visible = true;

        // Attach 3D formula labels directly to the 3D model in AR space
        const shapeType = shape.name.replace('holographic-', '').replace('shape-model-', '');
        const formulaLabels = this._create3DLabelsForShape(shapeType);
        shape.add(formulaLabels);

        anchor.add(shape);
        console.log(`App: Attached 3D Holographic shape "${shape.name}" with 3D AR formula labels to Tag #${tagId}`);
    }

    _create3DLabelsForShape(shapeType) {
        const group = new THREE.Group();
        group.name = 'shape-3d-formula-labels';

        let labels = [];
        if (shapeType === 'cube' || shapeType === 'fused-cube' || shapeType === '1') {
            labels = [
                { text: '🧊 3D Cube Geometry', position: [0, 0.13, 0], color: '#60a5fa' },
                { text: 'L = 10.0 cm  |  W = 10.0 cm  |  H = 10.0 cm', position: [0, 0.09, 0], color: '#38bdf8' },
                { text: 'Volume (V) = L × W × H = 1000 cm³', position: [0, -0.07, 0], color: '#fbbf24' },
                { text: 'Surface Area (SA) = 6 × a² = 600 cm²', position: [0, -0.11, 0], color: '#f472b6' }
            ];
        } else if (shapeType === 'tetrahedron' || shapeType === '0' || shapeType === '42') {
            labels = [
                { text: '🔺 3D Triangular Pyramid (Tetrahedron)', position: [0, 0.13, 0], color: '#60a5fa' },
                { text: 'Faces (F): 4  |  Vertices (V): 4  |  Edges (E): 6', position: [0, 0.09, 0], color: '#38bdf8' },
                { text: 'Euler\'s Law: F + V - E = 2  (4 + 4 - 6 = 2)', position: [0, -0.07, 0], color: '#fbbf24' },
                { text: 'Volume = (1/3) × Base Area × h  |  SA = √3 × a²', position: [0, -0.11, 0], color: '#f472b6' }
            ];
        } else if (shapeType === 'cylinder' || shapeType === '3') {
            labels = [
                { text: '🛢️ 3D Cylinder Solid', position: [0, 0.13, 0], color: '#60a5fa' },
                { text: 'Volume (V) = π × r² × h', position: [0, 0.09, 0], color: '#fbbf24' },
                { text: 'Total SA = 2πr(r + h)  |  Curved SA = 2πrh', position: [0, -0.07, 0], color: '#f472b6' }
            ];
        } else if (shapeType === 'cone' || shapeType === '4') {
            labels = [
                { text: '📐 3D Right Circular Cone', position: [0, 0.13, 0], color: '#60a5fa' },
                { text: 'Volume (V) = (1/3) × π × r² × h', position: [0, 0.09, 0], color: '#fbbf24' },
                { text: 'Curved SA = π × r × l  [l = √(r² + h²)]', position: [0, -0.07, 0], color: '#f472b6' }
            ];
        } else if (shapeType === 'sphere' || shapeType === '2') {
            labels = [
                { text: '🔮 3D Sphere Geometry', position: [0, 0.12, 0], color: '#60a5fa' },
                { text: 'Volume (V) = (4/3) × π × r³', position: [0, 0.08, 0], color: '#fbbf24' },
                { text: 'Surface Area (SA) = 4 × π × r²', position: [0, -0.07, 0], color: '#f472b6' }
            ];
        } else {
            labels = [
                { text: `✨ ${shapeType.toUpperCase()} Geometry`, position: [0, 0.09, 0], color: '#60a5fa' },
                { text: 'Euler\'s Polyhedron Law: F + V - E = 2', position: [0, -0.07, 0], color: '#fbbf24' }
            ];
        }

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

        // 2x Super-sampling for high DPI 3D text crispness
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

        // Preserve aspect ratio to prevent horizontal stretching/squishing
        const aspect = w / h;
        const scaleY = 0.024;
        const scaleX = scaleY * aspect;
        sprite.scale.set(scaleX, scaleY, 1);

        return sprite;
    }

    _buildShapeSelectorUI() {
        const container = document.getElementById('ui-container');
        if (!container) return;
        const existing = container.querySelector('.shape-selector-bar');
        if (existing) existing.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
