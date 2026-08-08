/**
 * TeacherConsole — classroom deployment and calibration controls.
 * No lesson logic lives here; it only exposes device/tracking configuration.
 */
export class TeacherConsole {
  constructor(eventBus, app) {
    this.eventBus = eventBus;
    this.app = app;
    this.root = null;
    this.open = false;
    this._listeners = [];
    this._render();
    this._bind();
  }

  _render() {
    this.root = document.createElement('aside');
    this.root.id = 'teacher-console';
    this.root.innerHTML = `
      <button id="teacher-console-toggle" class="tc-toggle" aria-expanded="false">⚙ Teacher Setup</button>
      <section class="tc-panel" hidden>
        <div class="tc-head"><div><b>Classroom Setup</b><small>Camera • marker scale • tracking</small></div><button id="tc-close">×</button></div>
        <div class="tc-section">
          <label>Camera</label>
          <select id="tc-camera"><option>Loading cameras…</option></select>
          <button id="tc-refresh" class="tc-btn">Refresh cameras</button>
        </div>
        <div class="tc-section">
          <label>Printed AprilTag size <strong id="tc-size-value">10.0 cm</strong></label>
          <input id="tc-size" type="range" min="4" max="30" step="0.5" value="10">
          <small>Measure the black-square marker on paper. Use the same size for Tags #1–#5.</small>
        </div>
        <div class="tc-section">
          <label>Tracking status</label>
          <div id="tc-tags" class="tc-tags">No markers detected</div>
          <div id="tc-camera-status" class="tc-muted">Camera: waiting</div>
        </div>
        <div class="tc-actions">
          <button id="tc-fullscreen" class="tc-btn primary">⛶ Fullscreen</button>
          <button id="tc-hide" class="tc-btn">Hide setup</button>
        </div>
        <div class="tc-note">Best classroom setup: fixed USB webcam, camera pointed straight down, printed markers flat and evenly lit.</div>
      </section>`;
    document.body.appendChild(this.root);
  }

  _bind() {
    const q = s => this.root.querySelector(s);
    const toggle = () => {
      this.open = !this.open;
      q('.tc-panel').hidden = !this.open;
      q('#teacher-console-toggle').setAttribute('aria-expanded', String(this.open));
      if (this.open) this._refreshCameras();
    };
    q('#teacher-console-toggle').addEventListener('click', toggle);
    q('#tc-close').addEventListener('click', toggle);
    q('#tc-hide').addEventListener('click', toggle);
    q('#tc-refresh').addEventListener('click', () => this._refreshCameras());
    q('#tc-camera').addEventListener('change', async e => {
      if (!e.target.value) return;
      try { await this.app.cameraFeed.switchCamera(e.target.value); }
      catch (err) { this._setCameraStatus(`Camera switch failed: ${err.message}`); }
    });
    q('#tc-size').addEventListener('input', e => {
      const cm = Number(e.target.value);
      q('#tc-size-value').textContent = `${cm.toFixed(1)} cm`;
      const m = cm / 100;
      const detector = this.app.apriltagDetector;
      for (const id of [1,2,3,4,5]) detector?.setTagSize?.(id, m);
      localStorage.setItem('repnewar.markerSizeCm', String(cm));
    });
    q('#tc-fullscreen').addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) {}
    });

    const saved = Number(localStorage.getItem('repnewar.markerSizeCm'));
    if (Number.isFinite(saved) && saved >= 4 && saved <= 30) {
      q('#tc-size').value = String(saved);
      q('#tc-size-value').textContent = `${saved.toFixed(1)} cm`;
    }

    const onTag = () => this._refreshTags();
    const onLost = () => this._refreshTags();
    const onReady = d => { this._setCameraStatus(`Camera: ${d.label || 'active'}`); if (this.open) this._refreshCameras(); };
    const onSwitched = d => this._setCameraStatus(`Camera: ${d.label || 'active'}`);
    this.eventBus.on('TAG_DETECTED', onTag); this.eventBus.on('TAG_UPDATED', onTag); this.eventBus.on('TAG_LOST', onLost);
    this.eventBus.on('CAMERA_READY', onReady); this.eventBus.on('CAMERA_SWITCHED', onSwitched);
    this._listeners.push(['TAG_DETECTED',onTag],['TAG_UPDATED',onTag],['TAG_LOST',onLost],['CAMERA_READY',onReady],['CAMERA_SWITCHED',onSwitched]);
  }

  async _refreshCameras() {
    const select = this.root.querySelector('#tc-camera');
    try {
      const devices = await this.app.cameraFeed.enumerateCameras();
      select.innerHTML = devices.length ? devices.map(d => `<option value="${d.deviceId}">${this._escape(d.label || 'Camera')}</option>`).join('') : '<option value="">No cameras found</option>';
      const active = this.app.cameraFeed.getActiveDeviceId();
      if (active) select.value = active;
    } catch (_) { select.innerHTML = '<option value="">Unable to enumerate cameras</option>'; }
  }

  _refreshTags() {
    const anchors = this.app.anchorManager?.getAllAnchors?.() || [];
    const ids = anchors.map(a => Number(a.tagId)).filter(Number.isFinite).sort((a,b)=>a-b);
    const el = this.root.querySelector('#tc-tags');
    el.innerHTML = ids.length ? ids.map(id => `<span class="tc-tag live">#${id} ✓</span>`).join('') : '<span class="tc-tag">No markers detected</span>';
  }
  _setCameraStatus(s) { const el=this.root.querySelector('#tc-camera-status'); if(el) el.textContent=s; }
  _escape(s) { return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
}
