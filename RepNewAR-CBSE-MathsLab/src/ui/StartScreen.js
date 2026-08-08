/**
 * StartScreen.js - Pre-Camera Access Landing Page
 *
 * Responsibility:
 * - Renders the initial landing page before camera permissions are requested.
 * - Handles the "Start AR" button click to initiate the camera feed.
 * - Displays a user-friendly error message if permission is denied or
 *   the camera is unavailable, with a retry button.
 */

export class StartScreen {
    /**
     * @param {EventBus} eventBus - The global event bus instance.
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.container = document.getElementById('start-screen');

        // Show the start screen by default.
        this.container.style.display = 'flex';

        this.render();
        this.listenForEvents();
    }

    /**
     * Renders the initial start screen with a "Start" button.
     */
    render() {
        this.container.innerHTML = `
            <div class="start-content">
                <h1>AR Educational Platform</h1>
                <p>Place your educational kit in front of the camera.</p>
                <button id="start-ar-btn">Start AR Experience</button>
            </div>
        `;

        document.getElementById('start-ar-btn').addEventListener('click', () => {
            this.startAR();
        });
    }

    /**
     * Hides the start screen and emits START_CAMERA.
     */
    startAR() {
        this.container.style.display = 'none';
        this.eventBus.emit('START_CAMERA');
    }

    /**
     * Shows a user-friendly error message when the camera cannot be started.
     *
     * @param {string} title - Short error title (e.g. "Camera Access Denied").
     * @param {string} message - Detailed explanation for the user.
     * @param {string} [actionLabel='Retry'] - Label for the retry button.
     */
    showError(title, message, actionLabel = 'Retry') {
        this.container.innerHTML = `
            <div class="start-content">
                <div class="camera-error">
                    <h2>${title}</h2>
                    <p>${message}</p>
                    <button id="retry-ar-btn">${actionLabel}</button>
                </div>
            </div>
        `;
        this.container.style.display = 'flex';

        document.getElementById('retry-ar-btn').addEventListener('click', () => {
            this.startAR();
        });
    }

    /**
     * Subscribes to camera error events from CameraFeed to display errors.
     * @private
     */
    listenForEvents() {
        this.eventBus.on('CAMERA_ERROR', (data) => {
            this.container.style.display = 'flex';

            const messages = {
                permission: {
                    title: 'Camera Access Denied',
                    message: 'The browser blocked camera access. Please enable camera permissions in your browser settings and try again.',
                },
                notfound: {
                    title: 'No Camera Found',
                    message: 'No camera was detected on this device. Please connect a webcam and reload the page.',
                },
                hardware: {
                    title: 'Camera Unavailable',
                    message: 'The camera is currently in use by another application or is experiencing a hardware issue.',
                },
                unsupported: {
                    title: 'Camera Not Supported',
                    message: 'Your browser does not support the requested camera resolution. Please try a different browser.',
                },
            };

            const info = messages[data.type] ?? messages.hardware;
            this.showError(info.title, info.message);
        });
    }
}
