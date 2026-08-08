# RepNewAR — CBSE Maths Lab Physical AR

Professional browser-based AR learning platform for 26 CBSE Maths Lab activities.

## Architecture

- **Three.js** — 3D rendering and overlays
- **AprilTag 36h11** — physical marker recognition
- **Vite** — development and production bundling
- **LessonManager + `import.meta.glob`** — deterministic lesson discovery
- **PhysicalMathLabLessonBase** — shared physical-kit lifecycle, tracking and UI
- **Activity registry JSON** — single source of truth for the 26 CBSE lessons

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. Use Chrome/Edge and allow camera access.

## Production verification

```powershell
npm run verify
npm run build
```

`npm run verify` checks all 26 lesson IDs, module files, exports, marker configurations and the packaged lesson loader.

## Physical AR flow

**Physical kit → AprilTag → USB webcam → live camera feed → tracked anchor → 3D AR overlay → educational measurement/feedback**

Print the included `public/physical-kit/CBSE-MathsLab-PROFESSIONAL-26-MARKER-BOOKLET.pdf` at 100% / Actual Size.

## Lesson catalog

The production browser exposes exactly 26 CBSE Maths Lab activities from Classes 3–5, 6–8 and 9–10. Legacy demo lessons are retained in source for reference but are intentionally not exposed in the production catalog.
