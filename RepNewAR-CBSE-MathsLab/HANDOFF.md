# RepNewAR — Clean Project Handoff

This package is the clean classroom handoff build of the CBSE Maths Lab AR application.

## Included

- 26 catalogued CBSE Maths Lab activities
- AprilTag 36h11 physical-marker tracking
- USB webcam workflow
- Teacher setup and calibration
- IFP fullscreen workflow
- Printable marker resources
- Automated lesson verification
- Classroom QA checklist
- GitHub Pages deployment workflow

## Local start

```powershell
npm install
npm run verify
npm run dev
```

Open `http://localhost:3000`.

## Release check

```powershell
npm run release:check
```

## Deployment

See `DEPLOY-GITHUB-PAGES.md`.

## Physical classroom validation

Use `CLASSROOM-QA-CHECKLIST.md` to validate each activity using the actual kit, webcam and IFP.
