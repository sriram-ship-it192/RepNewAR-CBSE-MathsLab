/**
 * LessonCard.js - Individual Lesson Card Component
 *
 * Responsibility:
 * - Renders a single lesson card showing metadata, tags, preview, and action button.
 * - Supports active/inactive state visualization.
 * - Entirely decoupled from lesson logic.
 */
export class LessonCard {
    /**
     * @param {Object} metadata - Lesson metadata object from LessonManager.
     * @param {Function} onSelect - Callback (lessonId, action) => void.
     * @param {boolean} [isActive=false] - Initial active state.
     */
    constructor(metadata, onSelect, isActive = false) {
        this._metadata = metadata || {};
        this._onSelect = onSelect;
        this._isActive = isActive;

        this._container = null;
        this._btn = null;
        this._onBtnClickBound = this._onBtnClick.bind(this);
    }

    /**
     * Renders and returns the DOM element for the lesson card.
     *
     * @returns {HTMLElement} Card DOM element.
     */
    render() {
        if (this._container) return this._container;

        const m = this._metadata;
        const id = m.id || 'unknown';
        const title = m.title || `Lesson ${id}`;
        const description = m.description || 'Interactive AR educational module.';
        const category = m.category || 'General';
        const difficulty = m.difficulty || 'Beginner';
        const tags = m.markerTags || m.supportedMarkerIds || [1, 2, 3, 4, 5];
        const previewUrl = m.thumbnail || m.previewImage || null;

        const tagBadges = tags.map(t => `<span class="lc-tag-badge">Tag #${t}</span>`).join(' ');

        this._container = document.createElement('div');
        this._container.className = `lb-lesson-card ${this._isActive ? 'active' : ''}`;
        this._container.dataset.lessonId = id;

        const previewHTML = previewUrl
            ? `<img src="${previewUrl}" alt="${title}" class="lc-preview-img" />`
            : `<div class="lc-preview-placeholder"><span>📐 3D AR</span></div>`;

        this._container.innerHTML = `
            <div class="lc-header">
                ${previewHTML}
                <span class="lc-category-badge">${category}</span>
                <span class="lc-difficulty-badge diff-${difficulty.toLowerCase()}">${difficulty}</span>
            </div>
            <div class="lc-body">
                <h3 class="lc-title">${title}</h3>
                <p class="lc-desc">${description}</p>
                <div class="lc-tags">
                    <span class="lc-tags-label">Marker Tags:</span> ${tagBadges}
                </div>
            </div>
            <div class="lc-footer">
                <button class="lc-action-btn ${this._isActive ? 'btn-active' : 'btn-primary'}">
                    ${this._isActive ? 'Active (Deactivate)' : 'Start Lesson'}
                </button>
            </div>
        `;

        this._btn = this._container.querySelector('.lc-action-btn');
        this._btn.addEventListener('click', this._onBtnClickBound);

        return this._container;
    }

    /**
     * Updates active visual state of the card.
     *
     * @param {boolean} isActive
     */
    updateState(isActive) {
        this._isActive = isActive;
        if (this._container) {
            if (isActive) {
                this._container.classList.add('active');
            } else {
                this._container.classList.remove('active');
            }
        }
        if (this._btn) {
            this._btn.className = `lc-action-btn ${isActive ? 'btn-active' : 'btn-primary'}`;
            this._btn.textContent = isActive ? 'Active (Deactivate)' : 'Start Lesson';
        }
    }

    /**
     * Releases event listeners and DOM nodes.
     */
    dispose() {
        if (this._btn) {
            this._btn.removeEventListener('click', this._onBtnClickBound);
        }
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }

        this._container = null;
        this._btn = null;
        this._onSelect = null;
        this._metadata = null;
    }

    // ------------------------------------------------------------------ //
    //  Private Handlers
    // ------------------------------------------------------------------ //

    _onBtnClick(e) {
        e.stopPropagation();
        if (typeof this._onSelect === 'function') {
            const action = this._isActive ? 'deactivate' : 'activate';
            this._onSelect(this._metadata.id, action);
        }
    }
}
