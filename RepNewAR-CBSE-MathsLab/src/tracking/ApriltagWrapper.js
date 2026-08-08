/**
 * ApriltagWrapper.js — Main-thread wrapper for the arenaxr/apriltag-js-standalone WASM module.
 *
 * This replicates the EXACT initialization and detection flow of the official
 * `apriltag.js` (https://github.com/arenaxr/apriltag-js-standalone) but runs
 * on the main thread instead of inside a Web Worker (no Comlink dependency).
 *
 * C API (bound via Module.cwrap()):
 *   atagjs_init()                            — init detector
 *   atagjs_destroy()                         — release resources
 *   atagjs_set_detector_options(7 floats)    — configure decimate, sigma, etc.
 *   atagjs_set_pose_info(fx, fy, cx, cy)     — camera intrinsics
 *   atagjs_set_img_buffer(w, h, stride)      — alloc/reuse image buffer (returns ptr)
 *   atagjs_set_tag_size(tagid, size)         — set physical size of a known tag
 *   atagjs_detect()                          — detect tags (returns ptr to JSON struct)
 *
 * The _set_img_buffer → HEAPU8.set → atagjs_detect → parse JSON flow matches
 * the official Apriltag.detect() signature exactly.
 */

export class ApriltagWrapper {

    constructor() {
        this._Module = null;
        this._ready = false;

        // Bound C functions
        this._initFn = null;
        this._destroyFn = null;
        this._setOptsFn = null;
        this._setPoseInfoFn = null;
        this._setImgBufferFn = null;
        this._setTagSizeFn = null;
        this._detectFn = null;

        // Default options for maximum detection precision
        this._opt = {
            quad_decimate: 1.0, // Full 640x480 resolution detection for high-density tags
            quad_sigma: 0.0,
            nthreads: 1,
            refine_edges: 1,
            max_detections: 0,
            return_pose: 1,
            return_solutions: 1,
        };
    }

    /**
     * Initializes the WASM detector.
     *
     * The official arenaxr WASM compiles `atagjs_init()` with the tag36h11
     * family.  We first init with the default, then attempt to dynamically
     * add the tag25h9 family so the detector recognises BOTH families.
     * This works if the underlying AprilTag C library functions
     * (apriltag_family_create / apriltag_detector_add_family) are linked
     * into the WASM and the detector pointer (the C static global `td`)
     * is accessible via Emscripten's exported globals (`Module._td`).
     * If dynamic add is not possible, the detector falls back to tag36h11
     * with a clear warning.
     *
     * @param {string|null} [family=null] - Requested family; tag25h9 is tried
     *   dynamically on top of the default tag36h11.
     * @returns {Promise<void>}
     */
    async initialize(family = null) {
        if (typeof window.AprilTagWasm !== 'function') {
            throw new Error('ApriltagWrapper: window.AprilTagWasm not available — script not loaded?');
        }

        const Module = await window.AprilTagWasm();
        this._Module = Module;

        // ── 1. Bind known C functions via Module.cwrap() ──
        this._initFn            = Module.cwrap('atagjs_init', 'number', []);
        this._destroyFn         = Module.cwrap('atagjs_destroy', 'number', []);
        this._setOptsFn         = Module.cwrap('atagjs_set_detector_options', 'number',
            ['number', 'number', 'number', 'number', 'number', 'number', 'number']);
        this._setPoseInfoFn     = Module.cwrap('atagjs_set_pose_info', 'number',
            ['number', 'number', 'number', 'number']);
        this._setImgBufferFn    = Module.cwrap('atagjs_set_img_buffer', 'number',
            ['number', 'number', 'number']);
        this._setTagSizeFn      = Module.cwrap('atagjs_set_tag_size', null,
            ['number', 'number']);
        this._detectFn          = Module.cwrap('atagjs_detect', 'number', []);

        // ── 2. Initialise with default family (tag36h11) ──
        this._initFn();
        const families = ['tag36h11'];
        console.log('ApriltagWrapper: Initialized with tag36h11');

        // ── 3. Attempt to dynamically add tag25h9 ──
        const requested = family || 'tag25h9';
        if (requested !== 'tag36h11') {
            this._tryAddFamily(Module, requested, families);
        }

        this._activeFamily = families.join('+');
        console.log('ApriltagWrapper: Active families: ' + this._activeFamily);

        // Set default detector options
        this._setOptsFn(
            this._opt.quad_decimate,
            this._opt.quad_sigma,
            this._opt.nthreads,
            this._opt.refine_edges,
            this._opt.max_detections,
            this._opt.return_pose,
            this._opt.return_solutions
        );

        this._ready = true;
    }

    /**
     * Attempts to dynamically add a tag family to the active detector.
     * @param {Object} Module   The Emscripten WASM module.
     * @param {string} family   Family name e.g. 'tag25h9'.
     * @param {string[]} families  Array to append the family name on success.
     * @private
     */
    _tryAddFamily(Module, family, families) {
        try {
            // Step 1: Try to bind the family_create function
            const famCreateFn = Module.cwrap('apriltag_family_create', 'number', ['string']);
            const famPtr = famCreateFn(family);
            if (!famPtr) {
                console.warn('ApriltagWrapper: apriltag_family_create returned null for ' + family);
                return;
            }
            console.log('ApriltagWrapper: Created family ' + family + ' at ptr ' + famPtr);

            // Step 2: Try multiple approaches to get the detector pointer
            let detectorPtr = null;

            // Approach A: Module._td (C static global)
            if (Module._td !== undefined) {
                detectorPtr = Module._td;
                console.log('ApriltagWrapper: Got detector ptr from Module._td =', detectorPtr);
            }

            // Approach B: Module._detector
            if (!detectorPtr && Module._detector !== undefined) {
                detectorPtr = Module._detector;
                console.log('ApriltagWrapper: Got detector ptr from Module._detector =', detectorPtr);
            }

            if (!detectorPtr) {
                console.warn('ApriltagWrapper: Could not get detector ptr — cannot add family ' + family + '. Using tag36h11 only.');
                return;
            }

            // Step 3: Bind and call add_family
            const addFn = Module.cwrap('apriltag_detector_add_family', 'number', ['number', 'number']);
            const result = addFn(detectorPtr, famPtr);
            if (result === 0) {
                families.push(family);
                console.log('ApriltagWrapper: Successfully added family ' + family);
            } else {
                console.warn('ApriltagWrapper: apriltag_detector_add_family returned ' + result + ' for ' + family);
            }
        } catch (e) {
            console.warn('ApriltagWrapper: Could not dynamically add family ' + family + ' (' + e.message + '). Using default tag36h11 only.');
        }
    }

    /** @returns {string} The active tag family name(s). */
    getActiveFamily() { return this._activeFamily || 'tag36h11'; }

    /**
     * Public detect method — identical signature to the official Apriltag.detect().
     *
     * @param {Uint8Array} grayscaleImg - Grayscale pixel data (width × height bytes).
     * @param {number} imgWidth         - Image width in pixels.
     * @param {number} imgHeight        - Image height in pixels.
     * @returns {Object[]} Array of detection objects (as returned by the WASM JSON).
     */
    detect(grayscaleImg, imgWidth, imgHeight) {
        if (!this._ready || !this._Module) {
            return [];
        }

        // 1. Set up the image buffer (allocates or reuses), returns pointer
        const imgBuffer = this._setImgBufferFn(imgWidth, imgHeight, imgWidth);

        // Safety check: image data fits
        if (imgWidth * imgHeight < grayscaleImg.length) {
            return [];
        }

        // 2. Copy grayscale pixel data into WASM heap
        this._Module.HEAPU8.set(grayscaleImg, imgBuffer);

        // 3. Call atagjs_detect() — returns pointer to t_str_json struct
        const strJsonPtr = this._detectFn();

        // 4. Read struct fields using Module.getValue
        // struct t_str_json { size_t len; char *str; size_t alloc_size; }
        const strJsonLen = this._Module.getValue(strJsonPtr, 'i32');

        if (strJsonLen === 0) {
            return [];
        }

        const strJsonStrPtr = this._Module.getValue(strJsonPtr + 4, 'i32');

        // 5. Build the JSON string from raw UTF-8 bytes in WASM heap
        const strJsonView = new Uint8Array(this._Module.HEAP8.buffer, strJsonStrPtr, strJsonLen);
        let detectionsJson = '';
        for (let i = 0; i < strJsonLen; i++) {
            detectionsJson += String.fromCharCode(strJsonView[i]);
        }

        // 6. Parse JSON into detection array
        return JSON.parse(detectionsJson);
    }

    /**
     * Sets camera intrinsics for pose estimation.
     * @param {number} fx  - Focal length X (pixels)
     * @param {number} fy  - Focal length Y (pixels)
     * @param {number} cx  - Principal point X (pixels)
     * @param {number} cy  - Principal point Y (pixels)
     */
    set_camera_info(fx, fy, cx, cy) {
        if (!this._ready) return;
        this._setPoseInfoFn(fx, fy, cx, cy);
    }

    /**
     * Sets the physical size (in metres) for a specific tag ID.
     * @param {number} tagid - AprilTag family ID.
     * @param {number} size  - Physical size in metres.
     */
    set_tag_size(tagid, size) {
        if (!this._ready) return;
        this._setTagSizeFn(tagid, size);
    }

    /**
     * Sets the maximum number of detections to return (0 = return all).
     * Re-calls _setOptsFn with the full options object (same as official).
     * @param {number} maxDetections
     */
    set_max_detections(maxDetections) {
        if (!this._ready) return;
        this._opt.max_detections = maxDetections;
        this._setOptsFn(
            this._opt.quad_decimate,
            this._opt.quad_sigma,
            this._opt.nthreads,
            this._opt.refine_edges,
            this._opt.max_detections,
            this._opt.return_pose,
            this._opt.return_solutions
        );
    }

    /**
     * Sets whether to return pose estimates.
     * @param {number} returnPose  (0 = no, 1 = yes)
     */
    set_return_pose(returnPose) {
        if (!this._ready) return;
        this._opt.return_pose = returnPose;
        this._setOptsFn(
            this._opt.quad_decimate,
            this._opt.quad_sigma,
            this._opt.nthreads,
            this._opt.refine_edges,
            this._opt.max_detections,
            this._opt.return_pose,
            this._opt.return_solutions
        );
    }

    /**
     * Sets whether to return alternative pose solution details.
     * @param {number} returnSolutions  (0 = no, 1 = yes)
     */
    set_return_solutions(returnSolutions) {
        if (!this._ready) return;
        this._opt.return_solutions = returnSolutions;
        this._setOptsFn(
            this._opt.quad_decimate,
            this._opt.quad_sigma,
            this._opt.nthreads,
            this._opt.refine_edges,
            this._opt.max_detections,
            this._opt.return_pose,
            this._opt.return_solutions
        );
    }

    /**
     * Releases WASM resources.
     */
    destroy() {
        if (this._destroyFn) {
            try { this._destroyFn(); } catch (e) { /* ignore */ }
        }
        this._Module = null;
        this._ready = false;
    }

    /** @returns {boolean} True if the detector is initialized and ready. */
    isReady() { return this._ready; }
}
