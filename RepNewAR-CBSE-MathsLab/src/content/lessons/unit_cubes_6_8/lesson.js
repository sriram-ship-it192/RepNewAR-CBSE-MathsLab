import * as THREE from 'three';
import { PhysicalMathLabLessonBase } from '../PhysicalMathLabLessonBase.js';

export class Lesson extends PhysicalMathLabLessonBase {
  constructor() {
    super({
      id: 'unit_cubes_6_8', title: 'Unit Cubes — Volume', category: 'CBSE Maths Lab • Classes 6–8', difficulty: 'Beginner',
      description: 'Arrange unit-cube markers to model length × width × height.', kind: 'cubes', shortLabel: 'Volume',
      activity: '3 × 2 × 2 = 12 units³', supportedMarkerIds: [1,2,3,4,5],
      defaultValue: 12, min: 1, max: 100, step: 1
    });
  }
  _displayValue() { return this._valueText(); }
  _valueText() {
    const v=this._demo;
    switch('cubes') {
      case 'angle': return `${Math.round(v)}°`;
      case 'clock': { const h=Math.floor(v/60)%24, m=Math.round(v)%60; return `${String(h||24).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
      case 'money': return `₹${Math.round(v)}`;
      case 'decimal': return (v/100).toFixed(2);
      case 'probability': return `${Math.round(v)}%`;
      case 'mensuration': return `${Math.round(v)} cm`;
      case 'jug': return `${Math.round(v)} mL`;
      case 'integer': return `${v>=0?'+':''}${Math.round(v)}`;
      case 'conic': return v<.67?'Circle':v<1.34?'Ellipse':'Parabola';
      default: return String(Math.round(v));
    }
  }
  _updateActivityState() { this._updateStatus(); }
  _renderUI() {
    super._renderUI();
    const buttons=this._ui?.querySelector('#pml-buttons');
    if(buttons) {
      const vals=this._buttonValues();
      buttons.innerHTML=vals.map(x=>`<button class="pml-btn" data-v="${x.v}">${x.label}</button>`).join('');
      buttons.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',()=>{this._demo=Number(b.dataset.v);const s=this._ui.querySelector('#pml-demo');if(s)s.value=this._demo;this._updateStatus();this._updateVisual();}));
    }
  }
  _buttonValues() {
    switch('cubes') {
      case 'angle': return [0,30,45,60,90,120,180].map(v=>({v,label:v+'°'}));
      case 'clock': return [510,630,750,900].map(v=>({v,label:this._clock(v)}));
      case 'conic': return [0,.5,1,1.5,2].map(v=>({v,label:v<.67?'Circle':v<1.34?'Ellipse':'Parabola'}));
      case 'money': return [50,100,126,250,500].map(v=>({v,label:'₹'+v}));
      case 'probability': return [25,50,60,75,100].map(v=>({v,label:v+'%'}));
      case 'decimal': return [10,25,37,50,75].map(v=>({v,label:(v/100).toFixed(2)}));
      default: return [1,2,3,4,5].map(v=>({v,label:String(v)}));
    }
  }
  _clock(v) { const h=Math.floor(v/60)%24,m=v%60; return `${String(h||24).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }

  _buildVisual() {
    const g=new THREE.Group();
    const kind='cubes';
    const color=0x38bdf8;
    g.add(this._text(this._config.shortLabel||this._config.title,.055));
    if(kind==='angle') this._angleVisual(g);
    else if(kind==='clock') this._clockVisual(g);
    else if(kind==='fraction_lab_3_5'||kind==='equivalent') this._fractionVisual(g);
    else if(kind==='decimal') this._decimalVisual(g);
    else if(kind==='money') this._moneyVisual(g);
    else if(kind==='tessellation'||kind==='pattern') this._patternVisual(g);
    else if(kind==='placevalue'||kind==='numbercards') this._placeVisual(g);
    else if(kind==='triangle'||kind==='geoboard') this._triangleVisual(g);
    else if(kind==='integer') this._integerVisual(g);
    else if(kind==='cubes') this._cubeVisual(g);
    else if(kind==='graph'||kind==='graph3d') this._graphVisual(g);
    else if(kind==='mensuration'||kind==='jug') this._measureVisual(g);
    else if(kind==='conic') this._conicVisual(g);
    else if(kind==='venn') this._vennVisual(g);
    else if(kind==='probability') this._probVisual(g);
    else this._genericVisual(g,color);
    return g;
  }
  _angleVisual(g) {
    let a=this._demo; const p=this._getWorld(1),q=this._getWorld(2); if(p&&q) a=Math.atan2(q.z-p.z,q.x-p.x)*180/Math.PI; a=(a+360)%360; if(a>180)a=360-a;
    const r=.18,rad=THREE.MathUtils.degToRad(a); const mat=this._material(0x22c55e); const red=this._material(0xef4444);
    const base=new THREE.Mesh(new THREE.BoxGeometry(.32,.012,.014),red);base.position.x=.16;g.add(base);const arm=new THREE.Group();arm.rotation.y=-rad;const rod=new THREE.Mesh(new THREE.BoxGeometry(.32,.014,.016),mat);rod.position.x=.16;arm.add(rod);g.add(arm);
    const pts=[];for(let i=0;i<=32;i++){const t=rad*i/32;pts.push(new THREE.Vector3(r*Math.cos(t),.014,-r*Math.sin(t)))}g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x38bdf8})));
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.022,24),this._material(0xf59e0b));hub.rotation.x=Math.PI/2;g.add(hub);g.add(this._text(`${Math.round(a)}°`,.045));
  }
  _clockVisual(g) { const minutes=this._demo%1440, h=(minutes/60)%12,m=minutes%60;const face=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.025,48),this._material(0xf8fafc));face.rotation.x=Math.PI/2;g.add(face);for(let i=0;i<12;i++){const ang=i*Math.PI/6;const dot=new THREE.Mesh(new THREE.SphereGeometry(.008,10,8),this._material(0x0f172a));dot.position.set(.135*Math.sin(ang),.018,.135*Math.cos(ang));g.add(dot)}const ah=(h+m/60)*Math.PI/6,am=m*Math.PI/30;const hand=(ang,len,col)=>{const grp=new THREE.Group();grp.rotation.y=-ang;const x=new THREE.Mesh(new THREE.BoxGeometry(len,.012,.012),this._material(col));x.position.x=len/2;grp.add(x);g.add(grp)};hand(am,.13,0x2563eb);hand(ah,.09,0xef4444);g.add(this._text(this._clock(minutes),.04)); }
  _fractionVisual(g) { const den=8, num=Math.max(1,Math.min(den,Math.round(this._demo)));const r=.15;for(let i=0;i<den;i++){const a=(i/den)*Math.PI*2;const shape=new THREE.Shape();shape.moveTo(0,0);for(let j=0;j<=1;j++){const t=a+j*Math.PI*2/den;shape.lineTo(r*Math.cos(t),r*Math.sin(t))}shape.lineTo(0,0);const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);g.add(new THREE.Mesh(geo,this._material(i<num?0x22c55e:0x334155)))}g.add(this._text(`${num}/${den}`,.05)); }
  _decimalVisual(g) { const n=Math.max(0,Math.round(this._demo));for(let i=0;i<10;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.045,.012,.08),this._material(i<Math.round(n/10)?0x3b82f6:0x26364f));m.position.x=(i-4.5)*.052;g.add(m)}for(let i=0;i<n%10;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.018,.012,.018),this._material(0x22c55e));m.position.set((i%5)*.028-.056, .02, Math.floor(i/5)*.028-.014);g.add(m)}g.add(this._text((n/100).toFixed(2),.045)); }
  _moneyVisual(g) { const vals=[10,20,50,100,200,500];vals.forEach((v,i)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.13,.012,.065),this._material([0x22c55e,0xf59e0b,0x3b82f6,0x8b5cf6,0xef4444,0x14b8a6][i]));m.position.set((i-2.5)*.055,0,0);g.add(m)});g.add(this._text(`₹${Math.round(this._demo)}`,.045)); }
  _patternVisual(g) { for(let i=0;i<6;i++){const a=i*Math.PI/3;const m=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.018,6),this._material(i%2?0x22c55e:0x38bdf8));m.position.set(.13*Math.cos(a),0,.13*Math.sin(a));g.add(m)}g.add(this._text('A B A B',.045)); }
  _placeVisual(g) { const digs=String(Math.abs(Math.round(this._demo))).padStart(4,'0').slice(-4),cols=[0x8b5cf6,0x3b82f6,0x22c55e,0xf59e0b];digs.split('').forEach((d,p)=>{for(let i=0;i<Math.min(+d,5);i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.04,.04,.04),this._material(cols[p]));m.position.set((p-1.5)*.07,(i%5)*.05,Math.floor(i/5)*.05);g.add(m)}});g.add(this._text(`${Number(this._demo).toLocaleString()}`,.045)); }
  _triangleVisual(g) { const pts=[];for(let i=2;i<=4;i++){const p=this._localPoint(i);if(p)pts.push(p)}if(pts.length<3){pts.push(new THREE.Vector3(-.12,0,0),new THREE.Vector3(.12,0,0),new THREE.Vector3(0,0,-.15))}pts.splice(3);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts,pts[0]]),new THREE.LineBasicMaterial({color:0x38bdf8}));g.add(line);pts.forEach(p=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.014,12,8),this._material(0xf59e0b));s.position.copy(p);g.add(s)});g.add(this._text('Triangle • sides / angles',.04)); }
  _integerVisual(g) { const line=new THREE.Mesh(new THREE.BoxGeometry(.48,.008,.008),this._material(0x64748b));g.add(line);for(let i=-5;i<=5;i++){const t=new THREE.Mesh(new THREE.BoxGeometry(.006,.025,.006),this._material(0x94a3b8));t.position.x=i*.045;g.add(t)}const p=new THREE.Mesh(new THREE.SphereGeometry(.018,16,10),this._material(this._demo<0?0xef4444:0x22c55e));p.position.x=Math.max(-5,Math.min(5,this._demo))*.045;g.add(p);g.add(this._text(`${this._demo>=0?'+':''}${Math.round(this._demo)}`,.045)); }
  _cubeVisual(g) { const n=Math.max(1,Math.round(this._demo));const side=Math.min(4,Math.max(1,Math.round(Math.cbrt(n))));for(let x=0;x<side;x++)for(let y=0;y<side;y++)for(let z=0;z<side;z++){const m=new THREE.Mesh(new THREE.BoxGeometry(.045,.045,.045),this._material(0x3b82f6));m.position.set((x-(side-1)/2)*.05,(y-(side-1)/2)*.05,(z-(side-1)/2)*.05);g.add(m)}g.add(this._text(`${side} × ${side} × ${side}`,.04)); }
  _graphVisual(g) { for(let i=-5;i<=5;i++){const h=new THREE.Mesh(new THREE.BoxGeometry(.004,.004,.5),new THREE.MeshBasicMaterial({color:0x334155}));h.position.x=i*.045;g.add(h);const v=h.clone();v.geometry=h.geometry.clone();v.rotation.y=Math.PI/2;v.position.z=i*.045;g.add(v)}const p=this._localPoint(2)||new THREE.Vector3(.1,0,-.13);const s=new THREE.Mesh(new THREE.SphereGeometry(.018,16,10),this._material(0xef4444));s.position.copy(p);g.add(s);g.add(this._text('Coordinate graph',.04)); }
  _measureVisual(g) { const d=this._distance(1,2);const len=d?d*100:Math.max(1,this._demo);const box=new THREE.Mesh(new THREE.BoxGeometry(.28,.1,.16),this._material(0x2563eb));g.add(box);const line=this._line(new THREE.Vector3(-.18,.08,0),new THREE.Vector3(.18,.08,0),0xf59e0b);g.add(line);g.add(this._text(`${len.toFixed(1)} cm`,.045)); }
  _conicVisual(g) { const t=this._demo;let geo;if(t<.67)geo=new THREE.TorusGeometry(.13,.008,12,48);else if(t<1.34)geo=new THREE.TorusGeometry(.13,.008,12,48,Math.PI*1.5);else geo=new THREE.TorusGeometry(.13,.008,12,48,Math.PI);const m=new THREE.Mesh(geo,this._material(0x38bdf8));g.add(m);g.add(this._text(t<.67?'Circle':t<1.34?'Ellipse':'Parabola',.045)); }
  _vennVisual(g) { const c1=new THREE.Mesh(new THREE.TorusGeometry(.12,.006,12,48),this._material(0x3b82f6));const c2=c1.clone();c2.material=this._material(0x22c55e);c1.position.x=-.07;c2.position.x=.07;g.add(c1,c2);const n=Math.round(this._demo);g.add(this._text(`A ∩ B = ${n}`,.045)); }
  _probVisual(g) { for(let i=0;i<5;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025,16,10),this._material(i/5*100<this._demo?0x22c55e:0x475569));m.position.set((i-2)*.06,0,0);g.add(m)}g.add(this._text(`P ≈ ${Math.round(this._demo)}%`,.045)); }
  _genericVisual(g,color) { const n=Math.max(1,Math.min(8,this._detectedCount()||Math.round(this._demo)));for(let i=0;i<n;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,.06),this._material(color));m.position.set((i-3.5)*.07,0,0);g.add(m)}g.add(this._text(String(this._demo),.045)); }
}
