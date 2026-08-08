import * as THREE from 'three';

/**
 * PhysicalMathLabLessonBase
 * A reusable marker-driven lesson base for the CBSE Maths Lab activity library.
 * Tag #1 is the kit/base marker; Tags #2-#5 represent movable kit pieces.
 * When markers are detected, the 3D overlay is anchored to the base marker and
 * measurements/visuals update from the tracked marker transforms.
 */
export class PhysicalMathLabLessonBase {
  constructor(config = {}) {
    this._config = {
      id: 'mathlab', title: 'Math Lab Activity', category: 'CBSE Maths Lab',
      difficulty: 'Beginner', description: '', kind: 'generic',
      supportedMarkerIds: [1, 2, 3, 4, 5],
      defaultValue: 50, min: 0, max: 100, step: 1,
      ...config,
    };
    this._context = null; this._active = false; this._anchors = new Map();
    this._visualRoot = null; this._ui = null; this._body = null;
    this._listeners = []; this._raf = 0; this._demo = this._config.defaultValue; this._physicalInfo = ''; this._lastSignature = ''; this._lastRender = 0;
  }
  async initialize(ctx) { this._context = ctx; }
  getMetadata() { return this._config; }

  async activate() {
    if (this._active) return;
    this._active = true; this._mountUI(); this._subscribe();
    const records = this._context?.anchorManager?.getAllAnchors?.() || [];
    records.forEach(r => this._onCreated(r));
    this._ensureFallback(); this._startLoop();
  }
  async deactivate() {
    if (!this._active) return;
    this._active = false; this._stopLoop(); this._unsubscribe(); this._unmountUI();
    this._removeVisual();
    this._anchors.clear();
  }
  async dispose() { await this.deactivate(); this._context = null; }

  _subscribe() {
    const bus = this._context?.eventBus; if (!bus) return;
    const created = d => this._onCreated(d);
    const updated = d => { if (this._anchors.has(d.tagId)) this._updateStatus(); };
    const removed = d => { this._anchors.delete(d.tagId); this._ensureFallback(); this._updateStatus(); };
    bus.on('ANCHOR_CREATED', created); bus.on('ANCHOR_UPDATED', updated); bus.on('ANCHOR_REMOVED', removed);
    this._listeners.push(['ANCHOR_CREATED', created], ['ANCHOR_UPDATED', updated], ['ANCHOR_REMOVED', removed]);
  }
  _unsubscribe() { const bus=this._context?.eventBus; if(!bus) return; this._listeners.forEach(([e,f])=>bus.off(e,f)); this._listeners=[]; }
  _onCreated({tagId, anchor}) { if (!this._config.supportedMarkerIds.includes(tagId) || !anchor) return; this._anchors.set(tagId, anchor); this._ensureFallback(); this._updateStatus(); }

  _ensureFallback() {
    if (!this._context?.scene) return;
    const base = this._anchors.get(1);

    // Production AR rule: never place a 3D object at an arbitrary screen/world
    // position when the physical reference marker is not visible. That creates
    // the misleading 'floating banner' effect and breaks physical alignment.
    if (!base) {
      if (this._visualRoot?.parent) this._visualRoot.parent.remove(this._visualRoot);
      this._dispose(this._visualRoot);
      this._visualRoot = null;
      if (this._fallback?.parent) this._fallback.parent.remove(this._fallback);
      this._fallback = null;
      return;
    }

    if (this._fallback?.parent) this._fallback.parent.remove(this._fallback);
    this._fallback = null;

    if (this._visualRoot?.parent !== base) {
      this._removeVisual();
      this._visualRoot = this._buildVisual();
      base.add(this._visualRoot);
    }
  }
  _startLoop() { const tick=()=>{ if(!this._active) return; this._updateVisual(); this._raf=requestAnimationFrame(tick); }; this._raf=requestAnimationFrame(tick); }
  _stopLoop() { if(this._raf) cancelAnimationFrame(this._raf); this._raf=0; }

  _getWorld(id) { const a=this._anchors.get(id); if(!a) return null; const p=new THREE.Vector3(); a.getWorldPosition(p); return p; }
  _distance(a,b) { const p=this._getWorld(a), q=this._getWorld(b); return p&&q?p.distanceTo(q):null; }
  _angle(a,b,c) {
    const A=this._getWorld(a), B=this._getWorld(b), C=this._getWorld(c); if(!A||!B||!C)return null;
    const u=A.clone().sub(B).normalize(), v=C.clone().sub(B).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(u.dot(v),-1,1)));
  }
  _detectedCount() { return this._anchors.size; }
  _localPoint(id) {
    const base=this._getWorld(1); const p=this._getWorld(id); return base&&p? p.sub(base):null;
  }

  _updateVisual() {
    if (!this._visualRoot) return;
    const now = performance.now();
    if (now - this._lastRender < 120) return;
    const points = [1,2,3,4,5].map(id => { const p=this._getWorld(id); return p ? `${id}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}` : `${id}:x`; }).join('|');
    const sig = `${this._demo}|${points}|${this._anchors.size}`;
    if (sig === this._lastSignature) { this._updateActivityState(); return; }
    this._lastSignature = sig; this._lastRender = now; this._updateActivityState();
    const fresh=this._buildVisual();
    const parent=this._visualRoot.parent; if(parent){ parent.remove(this._visualRoot); parent.add(fresh); }
    this._dispose(this._visualRoot); this._visualRoot=fresh;
  }
  _updateActivityState() {
    const ids=[...this._anchors.keys()].filter(id=>id>0);
    const live=this._anchors.has(1) && ids.length>1;
    if (live) {
      const result=this._computePhysicalValue();
      if (result && Number.isFinite(result.value)) {
        this._demo=this._clampDemo(result.value);
        this._physicalInfo=result.info || '';
      } else if (result && result.value !== undefined) {
        this._physicalInfo=result.info || '';
      }
    } else {
      this._physicalInfo='';
    }
    this._updateStatus();
    const info=this._ui?.querySelector('#pml-physical-info');
    if(info) info.innerHTML=this._physicalInfo ? `<b>Live measurement:</b><br>${this._physicalInfo}` : '';
  }

  _clampDemo(v) {
    const min=Number(this._config.min), max=Number(this._config.max);
    if(Number.isFinite(min) && Number.isFinite(max)) return THREE.MathUtils.clamp(v,min,max);
    return v;
  }

  _xzPoint(id) {
    const base=this._getWorld(1), p=this._getWorld(id);
    return base&&p ? new THREE.Vector2(p.x-base.x,p.z-base.z) : null;
  }

  _polygonArea(ids) {
    const pts=ids.map(id=>this._xzPoint(id)).filter(Boolean);
    if(pts.length<3) return null;
    // Sort around centroid so markers can be placed in any order.
    const c=pts.reduce((a,p)=>a.add(p),new THREE.Vector2()).multiplyScalar(1/pts.length);
    pts.sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x));
    let area=0; for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];area+=a.x*b.y-b.x*a.y;}
    return Math.abs(area)/2;
  }

  _computePhysicalValue() {
    const kind=this._config.kind;
    const ids=[...this._anchors.keys()].filter(id=>id>0);
    const p2=this._xzPoint(2), p3=this._xzPoint(3), p4=this._xzPoint(4), p5=this._xzPoint(5);
    const count=Math.max(0,ids.length-1);
    if(kind==='angle') {
      if(!p2) return null;
      let a=Math.abs(THREE.MathUtils.radToDeg(Math.atan2(p2.y,p2.x)));
      a=(a+360)%360; if(a>180)a=360-a;
      return {value:a,info:`Angle from physical pivot to Tag #2: <b>${a.toFixed(1)}°</b><br>Markers: #1 + #2`};
    }
    if(kind==='clock') {
      if(!p2) return null;
      let deg=THREE.MathUtils.radToDeg(Math.atan2(p2.x,-p2.y)); deg=(deg+360)%360;
      const minutes=Math.round(deg/6)%60, hour=(12+Math.floor(deg/30))%12 || 12;
      return {value:hour*60+minutes,info:`Physical hand direction: <b>${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}</b><br>Tag #2 is the moving hand.`};
    }
    if(kind==='triangle' && p2 && p3) {
      const A=this._getWorld(1),B=this._getWorld(2),C=this._getWorld(3);
      const ang=(P,Q,R)=>{const u=P.clone().sub(Q).normalize(),v=R.clone().sub(Q).normalize();return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(u.dot(v),-1,1)))};
      const a=ang(B,A,C),b=ang(A,B,C),c=180-a-b;
      return {value:b,info:`Vertices detected: #1, #2, #3<br>Angles: <b>${a.toFixed(1)}° / ${b.toFixed(1)}° / ${c.toFixed(1)}°</b>`};
    }
    if(kind==='geoboard' && p2 && p3 && p4) {
      const area=this._polygonArea([2,3,4,5].filter(id=>this._anchors.has(id)));
      if(area!==null) return {value:area,info:`Physical marker polygon area: <b>${area.toFixed(2)} square units</b><br>Vertices detected: ${count}`};
    }
    if(kind==='graph' && p2) {
      const x=Math.round(p2.x/0.05), y=Math.round(-p2.y/0.05);
      return {value:Math.max(0,Math.min(20,Math.abs(y))),info:`Tag #2 coordinate: <b>(${x}, ${y})</b>`};
    }
    if(kind==='graph3d' && p2) {
      const x=Math.round(p2.x/0.05), z=Math.round(-p2.y/0.05), y=this._getWorld(2)?.y||0;
      const yy=Math.round(y/0.05);
      return {value:Math.max(0,Math.min(20,Math.abs(yy))),info:`Tag #2 3D coordinate: <b>(${x}, ${yy}, ${z})</b>`};
    }
    if(kind==='mensuration' && p2) {
      const L=this._distance(1,2)||0, W=this._distance(1,3)||L*0.5;
      const l=Math.max(0.1,L*100), w=Math.max(0.1,W*100), area=l*w;
      return {value:area,info:`Physical dimensions: <b>L=${l.toFixed(1)} cm, W=${w.toFixed(1)} cm</b><br>Area: <b>${area.toFixed(1)} cm²</b>`};
    }
    if(kind==='jug' && p2) {
      const d=this._distance(1,2)||0; const ml=Math.round(THREE.MathUtils.clamp(d/0.30*1000,0,2000));
      return {value:ml,info:`Physical marker separation mapped to fill level: <b>${ml} mL</b>`};
    }
    if(kind==='money') {
      const den={2:10,3:20,4:50,5:100}; const total=ids.filter(id=>id!==1).reduce((s,id)=>s+(den[id]||0),0);
      return {value:total,info:`Detected money markers: <b>${count}</b><br>Mapped total: <b>₹${total}</b> (Tag #2 ₹10, #3 ₹20, #4 ₹50, #5 ₹100)`};
    }
    if(kind==='decimal') {
      const pieceValue={2:0.10,3:0.01,4:0.20,5:0.02};
      const labels={2:'1 tenth (0.10)',3:'1 hundredth (0.01)',4:'2 tenths (0.20)',5:'2 hundredths (0.02)'};
      const active=ids.filter(id=>id!==1);
      const total=active.reduce((sum,id)=>sum+(pieceValue[id]||0),0);
      const names=active.map(id=>`#${id} ${labels[id]||'piece'}`).join(', ') || 'none';
      return {value:Math.round(total*100),info:`Detected decimal pieces: <b>${names}</b><br>Value: <b>${total.toFixed(2)}</b>`};
    }
    if(kind==='fractions' || kind==='equivalent') {
      const den=kind==='equivalent'?{2:0.5,3:0.25,4:0.125,5:0.125}:{2:0.5,3:0.25,4:0.125,5:0.125};
      const total=ids.filter(id=>id!==1).reduce((s,id)=>s+(den[id]||0),0);
      return {value:Math.max(1,Math.min(8,Math.round(total*8))),info:`Detected fraction pieces: <b>${total.toFixed(3)}</b><br>Markers detected: ${ids.filter(id=>id!==1).map(id=>'#'+id).join(', ')||'none'}`};
    }
    if(kind==='placevalue' || kind==='numbercards') {
      const den={2:1000,3:100,4:10,5:1}; const total=ids.filter(id=>id!==1).reduce((s,id)=>s+(den[id]||0),0);
      return {value:Math.min(9999,total),info:`Detected place-value pieces: <b>${total.toLocaleString()}</b><br>#2 thousands • #3 hundreds • #4 tens • #5 ones`};
    }
    if(kind==='cubes') {
      const n=count; const a=Math.max(1,Math.min(6,n)), b=2, c=Math.max(1,Math.min(6,Math.ceil(n/4)));
      return {value:Math.min(100,a*b*c),info:`Detected cube markers: <b>${n}</b><br>Estimated volume model: <b>${a} × ${b} × ${c} = ${a*b*c} units³</b>`};
    }
    if(kind==='tessellation' || kind==='pattern') {
      return {value:Math.max(1,count),info:`Physical pieces detected: <b>${count}</b><br>Move Tags #2–#5 to build the pattern.`};
    }
    if(kind==='probability') {
      const favourable=this._anchors.has(2)?1:0, trials=Math.max(1,count);
      const pct=Math.round(favourable/trials*100);
      return {value:pct,info:`Experimental marker model: <b>${favourable}/${trials} = ${pct}%</b><br>Use Tags #2–#5 as trial/outcome pieces.`};
    }
    if(kind==='integer') {
      if(!p2) return null; const n=Math.round(p2.x/0.05); const val=THREE.MathUtils.clamp(n,-10,10);
      return {value:val,info:`Integer board position from Tag #2: <b>${val>=0?'+':''}${val}</b>`};
    }
    if(kind==='conic') {
      const n=count; const v=n<=1?0:n===2?0.5:1.5;
      return {value:v,info:`Detected section markers: <b>${n}</b><br>Model selection: ${v<.67?'Circle':v<1.34?'Ellipse':'Parabola'}`};
    }
    if(kind==='venn') {
      const pts=ids.filter(id=>id!==1).map(id=>this._xzPoint(id)).filter(Boolean);
      const insideA=pts.filter(p=>p.x<-0.02).length, insideB=pts.filter(p=>p.x>0.02).length, intersection=pts.filter(p=>Math.abs(p.x)<=0.02).length;
      return {value:Math.min(10,intersection),info:`Set members detected: <b>${pts.length}</b><br>Approx. intersection A ∩ B: <b>${intersection}</b>`};
    }
    if(kind==='geometry' || kind==='models') {
      if(p2) {
        const d=this._distance(1,2)||0; const cm=(d*100).toFixed(1);
        return {value:Math.min(Number(this._config.max)||100,Math.max(Number(this._config.min)||0,Math.round(d*100))),info:`Physical reference distance: <b>${cm} cm</b><br>Markers: ${ids.map(id=>'#'+id).join(', ')}`};
      }
    }
    return {value:this._demo,info:`Physical markers detected: <b>${count}</b>`};
  }

  _mountUI() {
    if(typeof document==='undefined')return;
    if(!document.getElementById('physical-mathlab-styles')){
      const s=document.createElement('style'); s.id='physical-mathlab-styles'; s.textContent=`
      .pml-panel{position:fixed;left:18px;bottom:18px;width:370px;max-width:calc(100vw - 36px);z-index:10002;background:rgba(5,15,30,.96);color:#e5eefc;border:1px solid rgba(56,189,248,.55);border-radius:16px;padding:15px;box-shadow:0 16px 55px #0009;font:13px system-ui,sans-serif;backdrop-filter:blur(10px)}
      .pml-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.pml-title{font-weight:900;color:#7dd3fc;font-size:15px}.pml-pill{color:#22c55e;border:1px solid #22c55e;border-radius:99px;padding:3px 7px;font-size:10px;font-weight:900}
      .pml-value{font-size:31px;font-weight:950;color:#60a5fa;margin-top:10px}.pml-type{font-weight:800;color:#cbd5e1;margin-top:2px}.pml-status{margin:10px 0;padding:9px;border-radius:9px;background:#0f1c31;line-height:1.5}.pml-ok{color:#4ade80}.pml-warn{color:#fbbf24}.pml-note{color:#94a3b8;font-size:11px;line-height:1.45;margin-top:9px}.pml-physical-info:empty{display:none}.pml-panel input,.pml-panel select{width:100%;box-sizing:border-box;background:#172033;color:#fff;border:1px solid #334155;border-radius:7px;padding:7px}.pml-btn{background:#172033;color:#fff;border:1px solid #334155;border-radius:7px;padding:6px 9px;margin:4px 4px 0 0;cursor:pointer;font-weight:800}.pml-btn:hover{border-color:#38bdf8}.pml-row{display:flex;gap:6px;flex-wrap:wrap}.pml-small{color:#cbd5e1;font-size:12px}
      `; document.head.appendChild(s);
    }
    this._ui=document.createElement('div'); this._ui.className='pml-panel'; document.body.appendChild(this._ui); this._renderUI();
  }
  _renderUI(){ this._ui.innerHTML=`<div class="pml-head"><div class="pml-title">${this._config.title}</div><span class="pml-pill">AR MODE</span></div><div class="pml-value" id="pml-value">${this._displayValue()}</div><div class="pml-type" id="pml-type">${this._config.activity||'Interactive activity'}</div><div class="pml-status" id="pml-status"></div><div class="pml-status" id="pml-physical-info"></div><input id="pml-demo" type="range" min="${this._config.min}" max="${this._config.max}" step="${this._config.step}" value="${this._demo}"><div class="pml-row" id="pml-buttons"><button class="pml-btn" data-action="3d">3D</button><button class="pml-btn" data-action="rotate">Rotate</button><button class="pml-btn" data-action="zoom">Zoom</button><button class="pml-btn" data-action="info">Info</button><button class="pml-btn" data-action="reset">Reset</button></div><div class="pml-note"><b>Physical setup:</b> Tag #1 = kit/base. Tags #2–#5 = movable pieces or reference points. Live mode is driven by detected marker poses; the slider is only a no-marker teaching fallback.</div>`; this._bindDemo(); this._bindControls(); this._updateStatus(); }
  _bindDemo(){ const s=this._ui?.querySelector('#pml-demo'); if(s)s.addEventListener('input',e=>{this._demo=Number(e.target.value);this._updateStatus();this._updateVisual();}); }
  _bindControls(){ this._ui?.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>this._handleControl(b.dataset.action))); }
  _handleControl(action){ if(!this._visualRoot)return; if(action==='rotate'){this._visualRoot.rotation.y+=Math.PI/6;} else if(action==='zoom'){const s=this._visualRoot.scale.x>1.05?.9:1.18;this._visualRoot.scale.multiplyScalar(s);} else if(action==='3d'){this._visualRoot.rotation.x=this._visualRoot.rotation.x===0?-Math.PI/7:0;} else if(action==='reset'){this._visualRoot.rotation.set(0,0,0);this._visualRoot.scale.set(1,1,1);this._demo=Number(this._config.defaultValue);const d=this._ui?.querySelector('#pml-demo');if(d)d.value=this._demo;this._updateStatus();this._updateVisual();} else if(action==='info'){const info=this._ui?.querySelector('#pml-physical-info');if(info)info.hidden=!info.hidden;} }
  _displayValue(){ return String(this._demo); }
  _updateStatus(){ if(!this._ui)return; const ids=[...this._anchors.keys()].filter(x=>x>0); const live=this._anchors.has(1)&&ids.length>1; const st=this._ui.querySelector('#pml-status'); if(st)st.innerHTML=live?`<span class="pml-ok">● LIVE TRACKING</span><br>Base marker: Tag #1 ✓<br>Detected kit markers: ${ids.map(i=>`#${i}`).join(', ')}`:`<span class="pml-warn">● DEMO / WAITING FOR MARKERS</span><br>Base marker (Tag #1): ${this._anchors.has(1)?'✓ detected':'waiting'}<br>Other markers detected: ${Math.max(0,ids.length-1)}`; const v=this._ui.querySelector('#pml-value');if(v)v.textContent=this._displayValue(); }
  _unmountUI(){if(this._ui?.parentNode)this._ui.parentNode.removeChild(this._ui);this._ui=null;this._body=null;}
  _removeVisual(){if(this._visualRoot?.parent)this._visualRoot.parent.remove(this._visualRoot);this._dispose(this._visualRoot);this._visualRoot=null;if(this._fallback?.parent)this._fallback.parent.remove(this._fallback);this._fallback=null;}
  _text(text,size=.055,color='#ffffff'){const c=document.createElement('canvas'),x=c.getContext('2d');c.width=1024;c.height=180;x.fillStyle='rgba(5,15,30,.82)';x.roundRect(8,8,1008,164,28);x.fill();x.fillStyle=color;x.font='bold 64px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(text,512,92);const tex=new THREE.CanvasTexture(c);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));s.scale.set(size*5.6,size,1);return s;}
  _material(color){return new THREE.MeshStandardMaterial({color,roughness:.38,metalness:.05});}
  _line(a,b,color=0x38bdf8,width=.008){const g=new THREE.BufferGeometry().setFromPoints([a,b]);return new THREE.Line(g,new THREE.LineBasicMaterial({color,linewidth:width}));}
  _buildVisual(){
    const g=new THREE.Group();
    const kind=this._config.kind;
    const blue=0x38bdf8, green=0x22c55e, amber=0xf59e0b, violet=0xa78bfa, red=0xef4444, slate=0x334155;
    const floor=new THREE.Mesh(new THREE.BoxGeometry(.72,.008,.52),this._material(0x10213d)); floor.position.y=-.04; g.add(floor);
    const addText=(t,c='#ffffff',s=.052)=>{const sp=this._text(t,s,c);sp.position.y=.28;g.add(sp);return sp;};
    const addDot=(p,c=blue,r=.035)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(r,20,20),this._material(c));m.position.copy(p);g.add(m);return m;};
    const addRod=(a,b,c=blue)=>{g.add(this._line(a,b,c,.012));addDot(a,c,.022);addDot(b,c,.022);};
    if(kind==='angle'){
      const p=this._localPoint(2)||new THREE.Vector3(.28,0,.18); const q=new THREE.Vector3(0,.015,0); addRod(q,p,green);
      const arc=new THREE.EllipseCurve(0,0,.16,.16,0,Math.atan2(p.z,p.x),false,0); const pts=arc.getPoints(24).map(v=>new THREE.Vector3(v.x,.018,v.y)); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:amber})));
      addText(`${Number(this._demo).toFixed(1)}°`,'#60a5fa',.06);
    } else if(kind==='clock'){
      const face=new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,.025,48),this._material(0xe2e8f0));face.rotation.x=Math.PI/2;g.add(face);
      const ang=Number(this._demo)%360*Math.PI/180; addRod(new THREE.Vector3(0,.03,0),new THREE.Vector3(.12*Math.sin(ang),.04,.12*Math.cos(ang)),red);
      addText(`${Math.floor(Number(this._demo)/60)%12||12}:${String(Math.round(Number(this._demo)%60)).padStart(2,'0')}`,'#22c55e',.045);
    } else if(kind==='triangle'){
      const pts=[this._localPoint(1)||new THREE.Vector3(-.18,0,.12),this._localPoint(2)||new THREE.Vector3(.18,0,.12),this._localPoint(3)||new THREE.Vector3(0,0,-.18)];
      pts.forEach((p,i)=>{if(i)g.add(this._line(pts[i-1],p,blue,.012));addDot(p,green,.025)});g.add(this._line(pts[2],pts[0],blue,.012));addText('Triangle • Σ angles = 180°','#ffffff',.04);
    } else if(kind==='geoboard'||kind==='graph'||kind==='graph3d'){
      for(let i=-3;i<=3;i++){g.add(this._line(new THREE.Vector3(i*.07,0,-.23),new THREE.Vector3(i*.07,0,.23),slate,.004));g.add(this._line(new THREE.Vector3(-.23,0,i*.07),new THREE.Vector3(.23,0,i*.07),slate,.004));}
      [2,3,4,5].filter(id=>this._anchors.has(id)).forEach(id=>addDot(this._localPoint(id)||new THREE.Vector3(),green,.025)); addText(kind==='geoboard'?'Area / polygon':'Coordinate grid','#ffffff',.045);
    } else if(kind==='fractions'||kind==='equivalent'){
      const pieces={2:[0,.5,0x60a5fa],3:[.5,.25,0x22c55e],4:[.75,.125,0xf59e0b],5:[.875,.125,0xa78bfa]};
      Object.entries(pieces).forEach(([id,arr])=>{if(!this._anchors.has(Number(id)))return;const x=Number(arr[0]),w=Number(arr[1]);const m=new THREE.Mesh(new THREE.BoxGeometry(w*.65,.035,.28),this._material(arr[2]));m.position.set(-.25+x*.5,.02,0);g.add(m);}); addText(kind==='equivalent'?'Equivalent fractions':'Fraction pieces','#ffffff',.042);
    } else if(kind==='decimal'){
      for(let i=0;i<10;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.055,.025,.25),this._material(i<Math.round(Number(this._demo)/10)?blue:slate));m.position.set(-.26+i*.058,.02,0);g.add(m);} addText(Number(this._demo/100).toFixed(2),'#60a5fa',.06);
    } else if(kind==='money'){
      const den={2:10,3:20,4:50,5:100}; let x=-.24; Object.entries(den).forEach(([id,v])=>{if(!this._anchors.has(Number(id)))return;const m=new THREE.Mesh(new THREE.BoxGeometry(.16,.018,.08),this._material(green));m.position.set(x,.02,0);g.add(m);addText(`₹${v}`,'#22c55e',.035);x+=.18;});
    } else if(kind==='placevalue'||kind==='cubes'){
      const colors=[red,amber,green,blue]; [2,3,4,5].forEach((id,i)=>{if(!this._anchors.has(id))return;const n=kind==='cubes'?Math.min(6,i+1):1;for(let j=0;j<n;j++){const m=new THREE.Mesh(new THREE.BoxGeometry(.045,.045,.045),this._material(colors[i]));m.position.set(-.22+i*.145+(j%3)*.05,.025+Math.floor(j/3)*.05,0);g.add(m);}}); addText(kind==='cubes'?'Unit-cube volume':'Place value','#ffffff',.042);
    } else if(kind==='tessellation'||kind==='pattern'){
      const shapes=[new THREE.CircleGeometry(.07,3),new THREE.PlaneGeometry(.12,.12),new THREE.CircleGeometry(.07,6)];[2,3,4,5].forEach((id,i)=>{if(!this._anchors.has(id))return;const m=new THREE.Mesh(shapes[i%3],this._material([blue,green,amber,violet][i]));m.rotation.x=-Math.PI/2;m.position.set(-.2+(i%2)*.2,.02,-.08+Math.floor(i/2)*.16);g.add(m);}); addText('Pattern / tessellation','#ffffff',.04);
    } else if(kind==='probability'){
      const n=Math.max(1,[2,3,4,5].filter(id=>this._anchors.has(id)).length); for(let i=0;i<n;i++){const m=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.03,24),this._material(i===0?green:blue));m.position.set(-.18+i*.12,.025,0);g.add(m);} addText(`Probability ${Number(this._demo).toFixed(0)}%`,'#60a5fa',.045);
    } else if(kind==='integer'){
      g.add(this._line(new THREE.Vector3(-.3,.02,0),new THREE.Vector3(.3,.02,0),blue,.015)); for(let i=-5;i<=5;i++)addDot(new THREE.Vector3(i*.055,.025,0),i===0?amber:slate,.015); const p=this._localPoint(2)||new THREE.Vector3(); addDot(new THREE.Vector3(THREE.MathUtils.clamp(p.x,-.28,.28),.035,0),green,.03); addText(`Integer ${this._demo>=0?'+':''}${Math.round(this._demo)}`,'#60a5fa',.045);
    } else if(kind==='jug'){
      const h=.22;const body=new THREE.Mesh(new THREE.CylinderGeometry(.11,.09,h,32,1,true),this._material(0x93c5fd));body.position.y=.08;g.add(body);const level=THREE.MathUtils.clamp(Number(this._demo)/2000,0,1);const water=new THREE.Mesh(new THREE.CylinderGeometry(.105,.085,Math.max(.01,h*level),32),this._material(0x38bdf8));water.position.y=.01+h*level/2;g.add(water);addText(`${Math.round(Number(this._demo))} mL`,'#60a5fa',.05);
    } else if(kind==='mensuration'||kind==='geometry'||kind==='models'){
      const box=new THREE.Mesh(new THREE.BoxGeometry(.28,.05,.18),this._material(violet));box.position.y=.02;g.add(box);addRod(new THREE.Vector3(-.14,.08,-.11),new THREE.Vector3(.14,.08,-.11),amber);addRod(new THREE.Vector3(.16,.08,-.08),new THREE.Vector3(.16,.08,.08),green);addText(kind==='mensuration'?'Area / volume':'Construction / model','#ffffff',.038);
    } else if(kind==='conic'){
      const r=.16; const curve=new THREE.EllipseCurve(0,0,r,r*.62,0,Math.PI*2);const pts=curve.getPoints(64).map(p=>new THREE.Vector3(p.x,.04,p.y));g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:violet})));addText('Conic section','#ffffff',.045);
    } else if(kind==='venn'){
      [new THREE.Vector3(-.09,.04,0),new THREE.Vector3(.09,.04,0)].forEach((p,i)=>{const c=new THREE.Mesh(new THREE.TorusGeometry(.12,.008,12,48),this._material(i?green:blue));c.position.copy(p);c.rotation.x=Math.PI/2;g.add(c);});addText('A ∩ B / sets','#ffffff',.045);
    } else { addText(this._config.shortLabel||this._config.title,.045); }
    return g;
  }
  _dispose(obj){if(!obj)return;obj.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{m.map?.dispose?.();m.dispose?.()})}})}
}
