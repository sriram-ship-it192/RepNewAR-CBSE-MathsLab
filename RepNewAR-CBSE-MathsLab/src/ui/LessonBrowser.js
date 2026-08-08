import { LessonSearch } from './LessonSearch.js';
import { LessonCard } from './LessonCard.js';

/**
 * LessonBrowser.js - Responsive Educational Lesson Browser & Selection UI
 *
 * Responsibility:
 * - Dynamically discovers and displays lessons from LessonManager.
 * - Provides search, category filtering, difficulty filtering, lesson activation,
 *   deactivation, and switching without hardcoding lesson logic.
 * - Listens to LESSON_LOADED, LESSON_ACTIVATED, LESSON_DEACTIVATED, LESSON_ERROR.
 * - Emits LESSON_SELECTED, LESSON_BROWSER_OPENED, LESSON_BROWSER_CLOSED.
 * - Modern dark translucent responsive UI (desktop, tablet, mobile).
 * - Complete memory management on dispose().
 */
export class LessonBrowser {
    /**
     * @param {EventBus} eventBus - Global event bus instance.
     * @param {LessonManager} lessonManager - Lesson manager instance.
     * @param {Object} [options={}] - Custom configuration options.
     */
    constructor(eventBus, lessonManager, options = {}) {
        this._eventBus = eventBus;
        this._lessonMgr = lessonManager;
        this._options = options;

        this._container = null;
        this._overlayEl = null;
        this._toggleBtnEl = null;
        this._cardGridEl = null;
        this._searchComp = null;

        this._visible = false;
        this._activeLessonId = null;
        this._cards = new Map(); // lessonId -> LessonCard instance

        this._listeners = [];
        this._busyLessonId = null;

        if (options.autoInitialize !== false) {
            this.initialize(options.container);
        }
    }

    /**
     * Initializes the LessonBrowser UI component and mounts DOM overlays & styles.
     *
     * @param {HTMLElement} [container=document.body] - Target container element.
     * @returns {LessonBrowser} returns this instance for chaining.
     */
    initialize(container = null) {
        if (this._overlayEl) return this;

        this._injectStyles();
        this._createDOM(container || (typeof document !== 'undefined' ? document.body : null));
        this._subscribeEvents();

        console.log('LessonBrowser: Initialized.');
        return this;
    }

    /**
     * Opens the Lesson Browser overlay.
     */
    open() {
        if (this._visible) return;
        this._visible = true;

        if (this._overlayEl) {
            this._overlayEl.classList.remove('hidden');
        }
        if (this._toggleBtnEl) {
            this._toggleBtnEl.classList.add('active');
        }

        this.refresh();
        this._emit('LESSON_BROWSER_OPENED', { timestamp: performance.now() });
    }

    /**
     * Closes the Lesson Browser overlay.
     */
    close() {
        if (!this._visible) return;
        this._visible = false;

        if (this._overlayEl) {
            this._overlayEl.classList.add('hidden');
        }
        if (this._toggleBtnEl) {
            this._toggleBtnEl.classList.remove('active');
        }

        this._emit('LESSON_BROWSER_CLOSED', { timestamp: performance.now() });
    }

    /**
     * Toggles visibility of the Lesson Browser overlay.
     */
    toggle() {
        if (this._visible) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Dynamically refreshes the lesson list from LessonManager.
     */
    refresh() {
        if (!this._lessonMgr) return;

        const available = this._lessonMgr.getAvailableLessons() || [];
        const current = this._lessonMgr.getCurrentLesson();
        this._activeLessonId = current ? current.id : null;

        this._renderLessonList(available);
    }

    /**
     * Activates a lesson by ID via LessonManager.
     *
     * @param {string} id
     */
    async activateLesson(id) {
        if (!this._lessonMgr) return;

        if (this._busyLessonId) return;
        this._busyLessonId = id;
        this._setBusyState(id, true);
        try {
            console.log(`LessonBrowser: Activating lesson "${id}"...`);
            const meta = this._lessonMgr._availableLessons?.get(id) || { id };
            this._emit('LESSON_SELECTED', { id, metadata: meta });

            await this._lessonMgr.activateLesson(id);
            this._activeLessonId = id;
            this._updateCardStates();

            // Auto-close browser overlay after activating
            this.close();

        } catch (err) {
            console.error(`LessonBrowser: Failed to activate lesson "${id}":`, err);
            this._showError(`Could not open this lesson. ${err?.message || 'Please try again.'}`);
        } finally {
            this._setBusyState(id, false);
            this._busyLessonId = null;
        }
    }

    _setBusyState(id, busy) {
        const card = this._cards.get(id);
        if (!card?._btn) return;
        card._btn.disabled = busy;
        card._btn.textContent = busy ? 'Opening…' : (card._isActive ? 'Active (Deactivate)' : 'Start Lesson');
    }

    _showError(message) {
        if (typeof document === 'undefined') return;
        let el = document.getElementById('lb-error-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'lb-error-toast';
            el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:10050;max-width:520px;padding:14px 16px;border-radius:12px;background:#3b0d0d;color:#fecaca;border:1px solid #ef4444;box-shadow:0 12px 35px #0008;font:600 13px system-ui';
            document.body.appendChild(el);
        }
        el.textContent = message;
        clearTimeout(this._errorTimer);
        this._errorTimer = setTimeout(() => el?.remove(), 6500);
    }

    /**
     * Deactivates the currently active lesson via LessonManager.
     */
    async deactivateCurrentLesson() {
        if (!this._lessonMgr) return;

        try {
            await this._lessonMgr.deactivateCurrentLesson();
            this._activeLessonId = null;
            this._updateCardStates();
        } catch (err) {
            console.error('LessonBrowser: Failed to deactivate current lesson:', err);
        }
    }

    /**
     * Releases all DOM elements, card instances, and event listeners.
     */
    dispose() {
        this.close();
        this._unsubscribeEvents();

        for (const card of this._cards.values()) {
            card.dispose();
        }
        this._cards.clear();

        if (this._searchComp) {
            this._searchComp.dispose();
            this._searchComp = null;
        }

        if (this._overlayEl && this._overlayEl.parentNode) {
            this._overlayEl.parentNode.removeChild(this._overlayEl);
        }
        if (this._toggleBtnEl && this._toggleBtnEl.parentNode) {
            this._toggleBtnEl.parentNode.removeChild(this._toggleBtnEl);
        }

        this._overlayEl = null;
        this._toggleBtnEl = null;
        this._cardGridEl = null;
        this._container = null;
        this._lessonMgr = null;
        this._eventBus = null;

        console.log('LessonBrowser: Disposed.');
    }

    // ------------------------------------------------------------------ //
    //  Private — DOM Construction & Render Loop
    // ------------------------------------------------------------------ //

    /**
     * Injects CSS stylesheet for LessonBrowser UI.
     * @private
     */
    _injectStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('ar-lesson-browser-styles')) return;

        const style = document.createElement('style');
        style.id = 'ar-lesson-browser-styles';
        style.textContent = `
            /* Floating Toggle Button */
            #lb-toggle-btn {
                display: flex !important;
                position: fixed;
                top: 16px;
                left: 16px;
                background: rgba(15, 23, 42, 0.92);
                border: 1px solid rgba(59, 130, 246, 0.6);
                border-radius: 8px;
                color: #38bdf8;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                font-weight: 700;
                padding: 10px 16px;
                cursor: pointer;
                z-index: 9998;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(8px);
                transition: background 0.2s, transform 0.2s;
            }
            #lb-toggle-btn:hover {
                background: rgba(30, 41, 59, 0.95);
                transform: translateY(-1px);
            }
            #lb-toggle-btn.active {
                border-color: #10b981;
                color: #10b981;
            }

            /* Fullscreen Dark Browser Overlay */
            #lb-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(15, 23, 42, 0.94);
                backdrop-filter: blur(12px);
                z-index: 9999;
                display: flex;
                flex-direction: column;
                color: #f8fafc;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-sizing: border-box;
                transition: opacity 0.3s ease, visibility 0.3s ease;
                opacity: 1;
                visibility: visible;
            }
            #lb-overlay.hidden {
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
            }

            /* Header Section */
            .lb-header {
                padding: 20px 24px 14px 24px;
                border-bottom: 1px solid rgba(59, 130, 246, 0.2);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .lb-title-group h2 {
                margin: 0 0 4px 0;
                font-size: 22px;
                font-weight: 800;
                color: #60a5fa;
            }
            .lb-title-group p {
                margin: 0;
                font-size: 13px;
                color: #94a3b8;
            }
            .lb-close-btn {
                background: rgba(30, 41, 59, 0.8);
                border: 1px solid rgba(148, 163, 184, 0.3);
                border-radius: 50%;
                width: 36px;
                height: 36px;
                color: #f1f5f9;
                font-size: 18px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .lb-close-btn:hover {
                background: rgba(239, 68, 68, 0.8);
            }

            /* Search Bar */
            .lb-search-bar {
                padding: 14px 24px;
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                background: rgba(30, 41, 59, 0.4);
                border-bottom: 1px solid rgba(59, 130, 246, 0.15);
            }
            .lb-search-input-wrapper {
                flex: 1;
                min-width: 240px;
                position: relative;
                display: flex;
                align-items: center;
            }
            .lb-search-icon {
                position: absolute;
                left: 12px;
                font-size: 14px;
                color: #94a3b8;
            }
            .lb-search-input {
                width: 100%;
                background: rgba(15, 23, 42, 0.8);
                border: 1px solid rgba(59, 130, 246, 0.4);
                border-radius: 8px;
                padding: 10px 12px 10px 36px;
                color: #f8fafc;
                font-size: 13px;
                outline: none;
                transition: border-color 0.2s;
            }
            .lb-search-input:focus {
                border-color: #38bdf8;
            }
            .lb-filter-group {
                display: flex;
                gap: 8px;
            }
            .lb-filter-select {
                background: rgba(15, 23, 42, 0.8);
                border: 1px solid rgba(59, 130, 246, 0.4);
                border-radius: 8px;
                padding: 10px 12px;
                color: #f8fafc;
                font-size: 13px;
                outline: none;
                cursor: pointer;
            }

            /* Scrollable Cards Grid */
            .lb-content-body {
                flex: 1;
                overflow-y: auto;
                padding: 20px 24px;
            }
            .lb-cards-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 20px;
            }

            /* Lesson Card Styling */
            .lb-lesson-card {
                background: rgba(30, 41, 59, 0.7);
                border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 12px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
            }
            .lb-lesson-card:hover {
                transform: translateY(-3px);
                border-color: #38bdf8;
                box-shadow: 0 10px 25px -5px rgba(56, 189, 248, 0.2);
            }
            .lb-lesson-card.active {
                border-color: #10b981;
                box-shadow: 0 0 16px rgba(16, 185, 129, 0.3);
            }
            .lc-header {
                height: 120px;
                background: rgba(15, 23, 42, 0.9);
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .lc-preview-placeholder {
                color: #60a5fa;
                font-size: 18px;
                font-weight: 700;
            }
            .lc-preview-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .lc-category-badge {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(37, 99, 235, 0.85);
                color: #fff;
                font-size: 10px;
                font-weight: 700;
                padding: 4px 8px;
                border-radius: 4px;
                text-transform: uppercase;
            }
            .lc-difficulty-badge {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(16, 185, 129, 0.85);
                color: #fff;
                font-size: 10px;
                font-weight: 700;
                padding: 4px 8px;
                border-radius: 4px;
                text-transform: uppercase;
            }
            .lc-body {
                padding: 16px;
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .lc-title {
                margin: 0 0 6px 0;
                font-size: 16px;
                font-weight: 700;
                color: #f1f5f9;
            }
            .lc-desc {
                margin: 0 0 12px 0;
                font-size: 12px;
                color: #94a3b8;
                line-height: 1.4;
                flex: 1;
            }
            .lc-tags {
                font-size: 11px;
                color: #cbd5e1;
            }
            .lc-tag-badge {
                display: inline-block;
                background: rgba(51, 65, 85, 0.8);
                border: 1px solid rgba(148, 163, 184, 0.2);
                border-radius: 4px;
                padding: 2px 6px;
                margin-right: 4px;
                font-size: 10px;
                color: #38bdf8;
            }
            .lc-footer {
                padding: 12px 16px;
                background: rgba(15, 23, 42, 0.6);
                border-top: 1px solid rgba(59, 130, 246, 0.15);
            }
            .lc-action-btn {
                width: 100%;
                padding: 10px;
                border: none;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: background 0.2s;
            }
            .lc-action-btn.btn-primary {
                background: #2563eb;
                color: #fff;
            }
            .lc-action-btn.btn-primary:hover {
                background: #1d4ed8;
            }
            .lc-action-btn.btn-active {
                background: #059669;
                color: #fff;
            }
            .lc-action-btn.btn-active:hover {
                background: #dc2626;
            }
            .lb-empty-state {
                grid-column: 1 / -1;
                text-align: center;
                padding: 40px;
                color: #94a3b8;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Creates DOM container elements.
     * @private
     */
    _createDOM(parent) {
        // 1. Floating Toggle Button
        this._toggleBtnEl = document.createElement('button');
        this._toggleBtnEl.id = 'lb-toggle-btn';
        this._toggleBtnEl.innerHTML = '📚 Browse Lessons';
        this._toggleBtnEl.addEventListener('click', () => this.toggle());
        parent.appendChild(this._toggleBtnEl);

        // 2. Fullscreen Browser Overlay
        this._overlayEl = document.createElement('div');
        this._overlayEl.id = 'lb-overlay';
        this._overlayEl.className = 'hidden';

        this._overlayEl.innerHTML = `
            <div class="lb-header">
                <div class="lb-title-group">
                    <h2>AR Educational Lessons</h2>
                    <p>Select an interactive 3D lesson to launch with physical AprilTag markers.</p>
                </div>
                <button class="lb-close-btn" title="Close Browser">✕</button>
            </div>
            <div class="lb-search-container"></div>
            <div class="lb-content-body">
                <div class="lb-cards-grid"></div>
            </div>
        `;

        parent.appendChild(this._overlayEl);

        const closeBtn = this._overlayEl.querySelector('.lb-close-btn');
        closeBtn.addEventListener('click', () => this.close());

        const searchContainer = this._overlayEl.querySelector('.lb-search-container');
        this._cardGridEl = this._overlayEl.querySelector('.lb-cards-grid');

        // Instantiate Search Component
        this._searchComp = new LessonSearch((filters) => {
            this._onFilterChange(filters);
        });
        searchContainer.appendChild(this._searchComp.render(['3D Geometry', 'Fractions'], ['Beginner', 'Intermediate']));
    }

    /**
     * Subscribes to EventBus lesson lifecycle events.
     * @private
     */
    _subscribeEvents() {
        if (!this._eventBus) return;

        const listen = (evt, fn) => {
            this._eventBus.on(evt, fn);
            this._listeners.push({ evt, fn });
        };

        listen('LESSON_LOADED', () => this.refresh());
        listen('LESSON_ACTIVATED', (data) => {
            this._activeLessonId = data?.id || null;
            this._updateCardStates();
        });
        listen('LESSON_DEACTIVATED', () => {
            this._activeLessonId = null;
            this._updateCardStates();
        });
        listen('LESSON_ERROR', (data) => {
            console.error('LessonBrowser: Received LESSON_ERROR:', data);
            if (data?.error) this._showError(data.error.message || 'The lesson could not be loaded.');
        });
    }

    /**
     * Unsubscribes all EventBus listeners.
     * @private
     */
    _unsubscribeEvents() {
        if (!this._eventBus) return;
        for (const { evt, fn } of this._listeners) {
            this._eventBus.off(evt, fn);
        }
        this._listeners = [];
        this._busyLessonId = null;
    }

    /**
     * Renders array of available lesson metadata objects.
     * @private
     */
    _renderLessonList(availableLessons) {
        if (!this._cardGridEl) return;

        // Dispose previous cards
        for (const card of this._cards.values()) {
            card.dispose();
        }
        this._cards.clear();

        const filters = this._searchComp ? this._searchComp.getFilters() : { query: '', category: 'all', difficulty: 'all' };
        const filtered = availableLessons.filter(lesson => this._matchesFilters(lesson, filters));

        if (filtered.length === 0) {
            this._cardGridEl.innerHTML = `
                <div class="lb-empty-state">
                    <h3>No lessons match your filter criteria.</h3>
                    <p>Try adjusting your search query or reset filters.</p>
                </div>
            `;
            return;
        }

        this._cardGridEl.innerHTML = '';
        filtered.forEach(meta => {
            const isActive = meta.id === this._activeLessonId;
            const card = new LessonCard(meta, (id, action) => {
                if (action === 'activate') {
                    this.activateLesson(id);
                } else {
                    this.deactivateCurrentLesson();
                }
            }, isActive);

            this._cards.set(meta.id, card);
            this._cardGridEl.appendChild(card.render());
        });
    }

    /**
     * Updates visual active states across all rendered cards.
     * @private
     */
    _updateCardStates() {
        for (const [id, card] of this._cards) {
            card.updateState(id === this._activeLessonId);
        }
    }

    /**
     * Filter matcher function.
     * @private
     */
    _matchesFilters(lesson, filters) {
        const q = filters.query;
        if (q) {
            const titleMatch = (lesson.title || '').toLowerCase().includes(q);
            const descMatch = (lesson.description || '').toLowerCase().includes(q);
            const idMatch = (lesson.id || '').toLowerCase().includes(q);
            if (!titleMatch && !descMatch && !idMatch) return false;
        }

        if (filters.category !== 'all' && (lesson.category || 'General') !== filters.category) {
            return false;
        }

        if (filters.difficulty !== 'all' && (lesson.difficulty || 'Beginner') !== filters.difficulty) {
            return false;
        }

        return true;
    }

    /**
     * Handles filter input change.
     * @private
     */
    _onFilterChange() {
        this.refresh();
    }

    /**
     * Helper to emit EventBus events safely.
     * @private
     */
    _emit(evt, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(evt, payload);
        }
    }
}
