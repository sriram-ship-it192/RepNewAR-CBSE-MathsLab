import * as THREE from 'three';
import { PhysicalMathLabLessonBase } from '../PhysicalMathLabLessonBase.js';

/**
 * Fraction Kit — Classes 3–5
 *
 * Physical mapping:
 *   Tag #1 = whole/base disc
 *   Tag #2 = 1/2 piece
 *   Tag #3 = 1/4 piece
 *   Tag #4 = 1/8 piece
 *   Tag #5 = 1/8 piece
 *
 * The AR overlay is anchored to Tag #1 and each detected piece is drawn at
 * the tracked local position of its physical marker. This makes the overlay
 * follow the actual kit pieces rather than a demo slider.
 */
export class Lesson extends PhysicalMathLabLessonBase {
  constructor() {
    super({
      id: 'fraction_lab_3_5',
      title: 'Fraction Kit — Fractions',
      category: 'CBSE Maths Lab • Classes 3–5',
      difficulty: 'Beginner',
      description: 'Move physical fraction pieces. The AR model follows the markers and calculates the combined fraction.',
      kind: 'fractions',
      shortLabel: 'Fraction Kit',
      activity: 'Build and compare fractions: 1/2, 1/4 and 1/8 pieces',
      supportedMarkerIds: [1, 2, 3, 4, 5],
      defaultValue: 4,
      min: 0,
      max: 8,
      step: 1,
    });

    this._pieceMap = {
      2: { numerator: 1, denominator: 2, label: '1/2', color: 0x22c55e },
      3: { numerator: 1, denominator: 4, label: '1/4', color: 0x38bdf8 },
      4: { numerator: 1, denominator: 8, label: '1/8', color: 0xf59e0b },
      5: { numerator: 1, denominator: 8, label: '1/8', color: 0xa78bfa },
    };
  }

  _displayValue() {
    const eighths = this._currentEighths();
    return `${eighths}/8`;
  }

  _currentEighths() {
    const ids = [2, 3, 4, 5].filter(id => this._anchors.has(id));
    return ids.reduce((sum, id) => {
      const p = this._pieceMap[id];
      return sum + (p ? (8 * p.numerator / p.denominator) : 0);
    }, 0);
  }

  _currentFraction() {
    const eighths = this._currentEighths();
    if (eighths === 0) return { n: 0, d: 1 };
    const g = (a, b) => b === 0 ? a : g(b, a % b);
    const divisor = g(eighths, 8);
    return { n: eighths / divisor, d: 8 / divisor };
  }

  _updateActivityState() {
    const eighths = this._currentEighths();
    const f = this._currentFraction();
    const detected = [2, 3, 4, 5].filter(id => this._anchors.has(id));
    const pct = Math.round((eighths / 8) * 100);

    if (detected.length) {
      const labels = detected.map(id => this._pieceMap[id].label).join(' + ');
      this._physicalInfo = `Pieces detected: <b>${labels}</b><br>` +
        `Combined fraction: <b>${f.n}/${f.d}</b> (${pct}%)<br>` +
        `Equivalent eighths: <b>${eighths}/8</b>`;
    } else {
      this._physicalInfo = '';
    }

    this._updateStatus();
    const info = this._ui?.querySelector('#pml-physical-info');
    if (info) info.innerHTML = this._physicalInfo ? `<b>Live fraction measurement</b><br>${this._physicalInfo}` : '';

    const v = this._ui?.querySelector('#pml-value');
    if (v) v.textContent = this._displayValue();
  }

  _renderUI() {
    super._renderUI();
    const buttons = this._ui?.querySelector('#pml-buttons');
    if (buttons) {
      buttons.innerHTML = `
        <button class="pml-btn" data-fraction="half">1/2</button>
        <button class="pml-btn" data-fraction="threequarters">3/4</button>
        <button class="pml-btn" data-fraction="one">1 Whole</button>
        <button class="pml-btn" data-fraction="clear">Clear</button>
      `;
      buttons.querySelectorAll('[data-fraction]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.fraction;
          this._demo = key === 'half' ? 4 : key === 'threequarters' ? 6 : key === 'one' ? 8 : 0;
          const slider = this._ui.querySelector('#pml-demo');
          if (slider) slider.value = this._demo;
          this._updateActivityState();
          this._updateVisual();
        });
      });
    }
  }

  _buildVisual() {
    const g = new THREE.Group();
    g.name = 'fraction-kit-ar-overlay';

    // Physical piece overlays follow their actual marker positions.
    const visiblePieces = [2, 3, 4, 5].filter(id => this._anchors.has(id));
    const radius = 0.055;

    for (const id of visiblePieces) {
      const piece = this._pieceMap[id];
      const p = this._localPoint(id);
      if (!p) continue;

      const pieceGroup = new THREE.Group();
      pieceGroup.position.set(p.x, 0.035, p.z);

      const denom = piece.denominator;
      const sector = (Math.PI * 2) / denom;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + sector, false);
      shape.lineTo(0, 0);

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: piece.color,
        transparent: true,
        opacity: 0.82,
        roughness: 0.25,
        metalness: 0.05,
      }));
      pieceGroup.add(mesh);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.93, radius, 32),
        new THREE.MeshBasicMaterial({ color: piece.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      pieceGroup.add(ring);

      const label = this._text(piece.label, 0.032, '#ffffff');
      label.position.y = 0.035;
      pieceGroup.add(label);

      g.add(pieceGroup);
    }

    // Whole reference circle around the physical base marker.
    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.124, 64),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.018;
    g.add(baseRing);

    const eighths = this._currentEighths();
    const f = this._currentFraction();
    const pct = Math.round((eighths / 8) * 100);
    const summary = this._text(`${f.n}/${f.d}  •  ${pct}%`, 0.05, '#ffffff');
    summary.position.set(0, 0.11, 0);
    g.add(summary);

    // A small AR hint when no physical piece is visible.
    if (visiblePieces.length === 0) {
      const hint = this._text('Show fraction pieces', 0.04, '#fbbf24');
      hint.position.y = 0.09;
      g.add(hint);
    }

    return g;
  }
}
