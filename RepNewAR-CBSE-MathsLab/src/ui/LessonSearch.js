/**
 * LessonSearch.js - Search and Filtering Component for Lesson Browser
 *
 * Responsibility:
 * - Provides real-time text query filtering, category selection, and difficulty filtering.
 * - Entirely decoupled from lesson content — emits filter state changes via callback.
 * - Pure DOM component with clean memory management on dispose().
 */
export class LessonSearch {
    /**
     * @param {Function} onFilterChange - Callback function (filters) => void.
     * @param {Object} [options={}] - Custom configuration options.
     */
    constructor(onFilterChange, options = {}) {
        this._onFilterChange = onFilterChange;
        this._options = options;

        this._query = '';
        this._category = 'all';
        this._difficulty = 'all';

        this._container = null;
        this._searchInput = null;
        this._categorySelect = null;
        this._difficultySelect = null;

        this._onInputBound = this._onInput.bind(this);
        this._onCategoryChangeBound = this._onCategoryChange.bind(this);
        this._onDifficultyChangeBound = this._onDifficultyChange.bind(this);
    }

    /**
     * Renders and returns the DOM element for the search & filter bar.
     *
     * @param {Array<string>} [categories=[]] - Available categories to populate.
     * @param {Array<string>} [difficulties=[]] - Available difficulties to populate.
     * @returns {HTMLElement} The search bar container DOM element.
     */
    render(categories = [], difficulties = []) {
        if (this._container) return this._container;

        this._container = document.createElement('div');
        this._container.className = 'lb-search-bar';

        const catOptions = ['all', ...categories]
            .map(cat => `<option value="${cat}">${cat === 'all' ? 'All Categories' : cat}</option>`)
            .join('');

        const diffOptions = ['all', ...difficulties]
            .map(diff => `<option value="${diff}">${diff === 'all' ? 'All Difficulties' : diff}</option>`)
            .join('');

        this._container.innerHTML = `
            <div class="lb-search-input-wrapper">
                <span class="lb-search-icon">🔍</span>
                <input type="text" class="lb-search-input" placeholder="Search lessons by title, topic, or tags..." value="${this._query}" />
            </div>
            <div class="lb-filter-group">
                <select class="lb-filter-select lb-category-select">
                    ${catOptions}
                </select>
                <select class="lb-filter-select lb-difficulty-select">
                    ${diffOptions}
                </select>
            </div>
        `;

        this._searchInput = this._container.querySelector('.lb-search-input');
        this._categorySelect = this._container.querySelector('.lb-category-select');
        this._difficultySelect = this._container.querySelector('.lb-difficulty-select');

        this._searchInput.addEventListener('input', this._onInputBound);
        this._categorySelect.addEventListener('change', this._onCategoryChangeBound);
        this._difficultySelect.addEventListener('change', this._onDifficultyChangeBound);

        return this._container;
    }

    /**
     * Returns current active filter parameters.
     *
     * @returns {{ query: string, category: string, difficulty: string }}
     */
    getFilters() {
        return {
            query: this._query,
            category: this._category,
            difficulty: this._difficulty,
        };
    }

    /**
     * Resets input fields to default values.
     */
    reset() {
        this._query = '';
        this._category = 'all';
        this._difficulty = 'all';

        if (this._searchInput) this._searchInput.value = '';
        if (this._categorySelect) this._categorySelect.value = 'all';
        if (this._difficultySelect) this._difficultySelect.value = 'all';

        this._notifyChange();
    }

    /**
     * Releases event listeners and DOM references.
     */
    dispose() {
        if (this._searchInput) {
            this._searchInput.removeEventListener('input', this._onInputBound);
        }
        if (this._categorySelect) {
            this._categorySelect.removeEventListener('change', this._onCategoryChangeBound);
        }
        if (this._difficultySelect) {
            this._difficultySelect.removeEventListener('change', this._onDifficultyChangeBound);
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }

        this._container = null;
        this._searchInput = null;
        this._categorySelect = null;
        this._difficultySelect = null;
        this._onFilterChange = null;
    }

    // ------------------------------------------------------------------ //
    //  Private Handlers
    // ------------------------------------------------------------------ //

    _onInput(e) {
        this._query = e.target.value.trim().toLowerCase();
        this._notifyChange();
    }

    _onCategoryChange(e) {
        this._category = e.target.value;
        this._notifyChange();
    }

    _onDifficultyChange(e) {
        this._difficulty = e.target.value;
        this._notifyChange();
    }

    _notifyChange() {
        if (typeof this._onFilterChange === 'function') {
            this._onFilterChange(this.getFilters());
        }
    }
}
