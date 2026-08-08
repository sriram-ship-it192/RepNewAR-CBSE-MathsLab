import * as THREE from 'three';

export class MathLabLessonBase {
  constructor(config) {
    this._config = { supportedMarkerIds: [1,2,3,4,5,-1], ...config };
    this._context = null;
    this._active = false;
    this._anchors = new Map();
    this._root = null;
    this._ui = null;
    this._listeners = [];
  }

  async initialize(context) { this._context = context; }
  getMetadata() { return this._config; }

  async activate() {
    if (this._active) return;
    this._active = true;
    this._mountUI();
    this._subscribe();
    const records = this._context?.anchorManager?.getAllAnchors?.() || [];
    for (const r of records) if (this._supported(r.tagId)) this._attach(r.tagId, r.anchor);
    if (!this._anchors.size && this._context?.scene) {
      this._root = new THREE.Group();
      this._root.name = `${this._config.id}-fallback-anchor`;
      this._root.position.set(0, 0, -0.3);
      this._context.scene.add(this._root);
      this._attach(-1, this._root);
    }
  }

  async deactivate() {
    if (!this._active) return;
    this._unsubscribe(); this._unmountUI(); this._detachAll();
    if (this._root?.parent) this._root.parent.remove(this._root);
    this._dispose(this._root); this._root = null; this._active = false;
  }
  async dispose() { await this.deactivate(); this._context = null; }

  _supported(id) { return this._config.supportedMarkerIds.includes(id); }
  _attach(tagId, anchor) {
    if (!anchor) return;
    this._detach(tagId);
    const group = this._buildScene();
    group.name = `${this._config.id}-${tagId}`;
    anchor.add(group); this._anchors.set(tagId, { anchor, group });
  }
  _detach(tagId) {
    const r = this._anchors.get(tagId); if (!r) return;
    r.anchor.remove(r.group); this._dispose(r.group); this._anchors.delete(tagId);
  }
  _detachAll() { [...this._anchors.keys()].forEach(id => this._detach(id)); }

  _subscribe() {
    const bus = this._context?.eventBus; if (!bus) return;
    const created = ({tagId, anchor}) => { if (this._active && this._supported(tagId)) this._attach(tagId, anchor); };
    const removed = ({tagId}) => this._detach(tagId);
    bus.on('ANCHOR_CREATED', created); bus.on('ANCHOR_REMOVED', removed);
    this._listeners.push(['ANCHOR_CREATED', created], ['ANCHOR_REMOVED', removed]);
  }
  _unsubscribe() {
    const bus = this._context?.eventBus; if (!bus) return;
    for (const [e, fn] of this._listeners) bus.off(e, fn); this._listeners = [];
  }

  _mountUI() {
    if (typeof document === 'undefined') return;
    this._ui = document.createElement('div');
    this._ui.className = 'mathlab-panel';
    this._ui.innerHTML = `<div class="mathlab-head"><b>${this._config.title}</b><span>AR MODE</span></div><div class="mathlab-body"></div>`;
    document.body.appendChild(this._ui);
    this._body = this._ui.querySelector('.mathlab-body');
    if (!document.getElementById('mathlab-styles')) {
      const s = document.createElement('style'); s.id = 'mathlab-styles';
      s.textContent = `.mathlab-panel{position:fixed;right:18px;bottom:18px;width:330px;background:rgba(8,15,30,.94);color:#e5eefc;border:1px solid #2563eb;border-radius:14px;padding:14px;font:13px system-ui;z-index:10000;box-shadow:0 12px 40px #0008}.mathlab-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:10px}.mathlab-head span{color:#22c55e;font-size:10px;border:1px solid #22c55e;padding:3px 6px;border-radius:99px}.mathlab-body label{display:block;color:#94a3b8;margin:8px 0 4px}.mathlab-body input,.mathlab-body select{width:100%;box-sizing:border-box;background:#172033;color:#fff;border:1px solid #334155;border-radius:7px;padding:7px}.mathlab-value{font-size:24px;color:#60a5fa;font-weight:800;margin:8px 0}.mathlab-note{color:#cbd5e1;line-height:1.45}.mathlab-btn{background:#2563eb;color:white;border:0;border-radius:7px;padding:7px 10px;margin:4px 4px 0 0;cursor:pointer}.mathlab-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:8px}.mathlab-chip{padding:6px;text-align:center;background:#172033;border-radius:5px}`;
      document.head.appendChild(s);
    }
    this._renderUI();
  }
  _renderUI() {}
  _setBody(html) { if (this._body) this._body.innerHTML = html; }
  _bind(selector, event, fn) { const el = this._ui?.querySelector(selector); if (!el) return; el.addEventListener(event, fn); this._listeners.push([`__dom_${selector}_${event}`, () => el.removeEventListener(event, fn)]); }
  _unmountUI() { if (this._ui?.parentNode) this._ui.parentNode.removeChild(this._ui); this._ui=null; this._body=null; this._listeners=[]; }
  _buildScene() { return new THREE.Group(); }
  _dispose(obj) { if (!obj) return; obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>m.dispose?.()); }}); }

  _text(text, size=.08, color=0xffffff) {
    // Sprite text keeps lessons asset-free and works with the existing Vite app.
    const c=document.createElement('canvas'), x=c.getContext('2d'); c.width=512;c.height=128;
    x.fillStyle='#ffffff';x.font='bold 48px Arial';x.textAlign='center';x.fillText(text,256,78);
    const tex=new THREE.CanvasTexture(c); const mat=new THREE.SpriteMaterial({map:tex,transparent:true});
    const s=new THREE.Sprite(mat); s.scale.set(size*4,size,1); return s;
  }
}
