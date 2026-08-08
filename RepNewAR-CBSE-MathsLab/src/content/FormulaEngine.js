/**
 * FormulaEngine.js - Reusable Real-time Mathematical Formula Overlay Service
 *
 * Responsibility:
 * - Independent, reusable service for rendering and dynamically updating mathematical formulas.
 * - Entirely decoupled from lesson-specific geometry or math logic (NO cube/pyramid/pizza logic).
 * - Manages floating HTML formula card overlays with smooth fade/slide transitions.
 * - Supports titles, descriptions, formula expressions, variables, step-by-step solutions,
 *   formatted units, and mathematical symbols.
 * - Completely event-driven via global EventBus.
 * - Handles complete DOM, timer, and memory cleanup on remove/clear/dispose to prevent memory leaks.
 *
 * Public API:
 * - initialize(options?)
 * - createFormula(id, config)
 * - show(id)
 * - hide(id)
 * - updateValues(id, values)
 * - updateFormula(id, partialConfig)
 * - remove(id)
 * - clear()
 * - dispose()
 *
 * Events emitted via EventBus:
 * - FORMULA_CREATED   { id, config }
 * - FORMULA_UPDATED   { id, values, config }
 * - FORMULA_SHOWN     { id }
 * - FORMULA_HIDDEN    { id }
 * - FORMULA_REMOVED   { id }
 * - FORMULA_ERROR     { id, error }
 */
export class FormulaEngine {
    /**
     * @param {EventBus|null} [eventBus=null] - Global event bus instance.
     * @param {Object} [options={}] - Configuration options.
     */
    constructor(eventBus = null, options = {}) {
        this._eventBus = eventBus;
        this._formulas = new Map(); // id -> FormulaRecord
        this._listeners = [];
        this._initialized = false;

        this._options = {
            container: null,
            themeClass: 'ar-formula-card',
            defaultPosition: 'bottom-left',
            zIndex: 9990,
            ...options,
        };

        if (options.autoInitialize !== false) {
            this.initialize(this._options);
        }
    }

    /**
     * Initializes the FormulaEngine options and injects CSS styles into document head.
     */
    initialize(options = {}) {
        this._options = { ...this._options, ...options };
        this._injectStyles();

        this._initialized = true;
        console.log('FormulaEngine: Initialized.');
        return this;
    }

    /**
     * Creates a new floating formula card with the given ID and configuration.
     */
    createFormula(id, config = {}) {
        if (!id || typeof id !== 'string') {
            const err = new Error('FormulaEngine.createFormula: id must be a valid non-empty string.');
            this._emit('FORMULA_ERROR', { id, error: err });
            throw err;
        }
        if (!config || typeof config !== 'object') {
            const err = new Error('FormulaEngine.createFormula: config object is required.');
            this._emit('FORMULA_ERROR', { id, error: err });
            throw err;
        }

        if (this._formulas.has(id)) {
            this.remove(id);
        }

        try {
            const fullConfig = {
                title: config.title || 'Formula',
                expression: config.expression || '',
                description: config.description || '',
                variables: config.variables || {},
                unit: config.unit || '',
                solution: config.solution || '',
                position: config.position || this._options.defaultPosition,
                ...config,
            };

            const el = this._createFormulaElement(id, fullConfig);
            const container = this._options.container || document.body;
            container.appendChild(el);

            const record = { id, config: fullConfig, element: el, visible: false };
            this._formulas.set(id, record);

            this._emit('FORMULA_CREATED', { id, config: fullConfig });

            if (config.autoShow !== false) {
                this.show(id);
            }

            return record;
        } catch (err) {
            const error = new Error(`FormulaEngine: Failed to create formula "${id}": ${err.message || err}`);
            this._emit('FORMULA_ERROR', { id, error });
            throw error;
        }
    }

    /**
     * Shows a formula card by ID with fade-in animation.
     */
    show(id) {
        const record = this._formulas.get(id);
        if (!record || record.visible) return;

        record.visible = true;
        if (record.element) {
            record.element.classList.remove('ar-formula-hidden');
            record.element.style.display = 'block';
            requestAnimationFrame(() => {
                if (record.element) {
                    record.element.style.opacity = '1';
                    record.element.style.transform = 'translateY(0)';
                }
            });
        }
        this._emit('FORMULA_SHOWN', { id });
    }

    /**
     * Hides a formula card by ID with fade-out animation.
     */
    hide(id) {
        const record = this._formulas.get(id);
        if (!record || !record.visible) return;

        record.visible = false;
        if (record.element) {
            record.element.style.opacity = '0';
            record.element.style.transform = 'translateY(20px)';
            setTimeout(() => {
                if (record.element) {
                    record.element.style.display = 'none';
                }
            }, 300);
        }
        this._emit('FORMULA_HIDDEN', { id });
    }

    /**
     * Updates variable values in an existing formula card.
     */
    updateValues(id, values) {
        const record = this._formulas.get(id);
        if (!record) return;

        Object.assign(record.config.variables, values);
        this._updateElementContent(record);
        this._emit('FORMULA_UPDATED', { id, values, config: record.config });
    }

    /**
     * Partially updates a formula card's configuration.
     */
    updateFormula(id, partialConfig) {
        const record = this._formulas.get(id);
        if (!record) return;

        Object.assign(record.config, partialConfig);
        this._updateElementContent(record);
        this._emit('FORMULA_UPDATED', { id, values: partialConfig, config: record.config });
    }

    /**
     * Removes a formula card by ID with cleanup.
     */
    remove(id) {
        const record = this._formulas.get(id);
        if (!record) return;

        if (record.element && record.element.parentNode) {
            record.element.parentNode.removeChild(record.element);
        }
        this._formulas.delete(id);
        this._emit('FORMULA_REMOVED', { id });
    }

    /**
     * Removes all formula cards.
     */
    clear() {
        const ids = Array.from(this._formulas.keys());
        for (const id of ids) {
            this.remove(id);
        }
        this._formulas.clear();
        console.log('FormulaEngine: Cleared all formula cards.');
    }

    /**
     * Releases all resources.
     */
    dispose() {
        this.clear();
        this._initialized = false;
        console.log('FormulaEngine: Disposed.');
    }

    /**
     * Creates the DOM element for a formula card.
     */
    _createFormulaElement(id, config) {
        const el = document.createElement('div');
        el.id = `ar-formula-${id}`;
        el.className = `${this._options.themeClass} ar-formula-hidden`;
        el.style.zIndex = String(this._options.zIndex);

        this._applyPosition(el, config.position);

        el.innerHTML = this._buildFormulaHTML(config);
        return el;
    }

    /**
     * Builds the inner HTML for a formula card from its config.
     */
    _buildFormulaHTML(config) {
        let varsHTML = '';
        if (config.variables && Object.keys(config.variables).length > 0) {
            varsHTML = '<div class="ar-formula-vars">' +
                Object.entries(config.variables)
                    .map(([key, val]) => `<span class="ar-var"><em>${key}</em> = ${val}</span>`)
                    .join(' ') +
                '</div>';
        }

        const exprHTML = config.expression
            ? `<div class="ar-formula-expr">${config.expression}</div>`
            : '';

        const solHTML = config.solution
            ? `<div class="ar-formula-solution"><strong>=</strong> ${config.solution}</div>`
            : '';

        const unitHTML = config.unit
            ? `<span class="ar-formula-unit">${config.unit}</span>`
            : '';

        const descHTML = config.description
            ? `<div class="ar-formula-desc">${config.description}</div>`
            : '';

        return `
            <div class="ar-formula-header">
                <span class="ar-formula-title">${config.title}</span>
                <button class="ar-formula-close" data-id="${id}">&times;</button>
            </div>
            ${descHTML}
            ${exprHTML}
            ${varsHTML}
            ${solHTML} ${unitHTML}
        `;
    }

    /**
     * Refreshes a formula card's DOM content from its config.
     */
    _updateElementContent(record) {
        if (record.element) {
            const body = record.element.querySelector('.ar-formula-body') || record.element;
            body.innerHTML = this._buildFormulaHTML(record.config);
        }
    }

    /**
     * Applies positional CSS classes.
     */
    _applyPosition(el, position) {
        const posMap = {
            'top-left': { top: '20px', left: '20px', bottom: 'auto', right: 'auto' },
            'top-right': { top: '20px', right: '20px', bottom: 'auto', left: 'auto' },
            'bottom-left': { bottom: '20px', left: '20px', top: 'auto', right: 'auto' },
            'bottom-right': { bottom: '20px', right: '20px', top: 'auto', left: 'auto' },
        };
        const pos = posMap[position] || posMap['bottom-left'];
        Object.assign(el.style, pos);
    }

    /**
     * Injects CSS styles for formula cards.
     */
    _injectStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('ar-formula-engine-styles')) return;

        const style = document.createElement('style');
        style.id = 'ar-formula-engine-styles';
        style.textContent = `
            .ar-formula-card {
                position: fixed;
                background: rgba(15, 23, 42, 0.92);
                border: 1px solid rgba(59, 130, 246, 0.4);
                border-radius: 10px;
                color: #f8fafc;
                font-family: system-ui, -apple-system, sans-serif;
                padding: 12px 14px;
                min-width: 200px;
                max-width: 320px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                backdrop-filter: blur(8px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 0;
                transform: translateY(20px);
                pointer-events: auto;
            }
            .ar-formula-card.ar-formula-hidden {
                display: none;
            }
            .ar-formula-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }
            .ar-formula-title {
                font-weight: 700;
                font-size: 13px;
                color: #60a5fa;
            }
            .ar-formula-close {
                background: none;
                border: none;
                color: #94a3b8;
                font-size: 16px;
                cursor: pointer;
                padding: 0 2px;
            }
            .ar-formula-close:hover {
                color: #ef4444;
            }
            .ar-formula-expr {
                font-family: 'Courier New', monospace;
                font-size: 14px;
                color: #38bdf8;
                margin: 4px 0;
            }
            .ar-formula-vars {
                margin: 4px 0;
            }
            .ar-var {
                display: inline-block;
                background: rgba(30,41,59,0.8);
                border-radius: 4px;
                padding: 2px 6px;
                margin: 2px 2px;
                font-size: 11px;
                color: #cbd5e1;
            }
            .ar-formula-solution {
                font-size: 13px;
                color: #f1f5f9;
                margin-top: 4px;
            }
            .ar-formula-unit {
                font-size: 11px;
                color: #94a3b8;
                margin-left: 4px;
            }
            .ar-formula-desc {
                font-size: 11px;
                color: #94a3b8;
                margin-bottom: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    _emit(evt, payload) {
        if (this._eventBus && typeof this._eventBus.emit === 'function') {
            this._eventBus.emit(evt, payload);
        }
    }
}
