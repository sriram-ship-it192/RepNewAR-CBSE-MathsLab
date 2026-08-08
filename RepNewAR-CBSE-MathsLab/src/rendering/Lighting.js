import * as THREE from 'three';

/**
 * Lighting.js - Environmental and Directional Lighting Setup
 * 
 * Responsibility:
 * - Sets up the default lighting environment for the 3D scene.
 * - Ensures 3D models are visible and realistic against the camera feed.
 */

export class Lighting {
    /**
     * @param {THREE.Scene} scene - The main Three.js scene.
     */
    constructor(scene) {
        this.scene = scene;
        this.ambientLight = null;
        this.directionalLight = null;
    }

    /**
     * Initializes scene ambient and directional lighting.
     */
    init() {
        if (!this.scene) return;

        console.log('Lighting: Initializing scene lighting...');

        // Soft white ambient light to illuminate shadows
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        this.scene.add(this.ambientLight);

        // Key directional light simulating sun/overhead light
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.directionalLight.position.set(5, 10, 7);
        this.scene.add(this.directionalLight);
    }
}
