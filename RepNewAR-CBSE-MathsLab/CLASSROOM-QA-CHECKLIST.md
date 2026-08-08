# RepNewAR — Phase 6 Classroom QA

This phase separates **automated software checks** from **physical classroom validation**. Passing the automated checks does not claim that a webcam has been physically calibrated or that every manufactured kit has been measured.

## Automated gate

Run:

```powershell
npm run verify
npm run qa
npm run build
```

Expected: 26/26 lessons and a successful production build.

## Manual gate

For each lesson:

- [ ] Lesson opens from Browse Lessons.
- [ ] Camera permission and live feed work.
- [ ] Required AprilTags are detected.
- [ ] UI changes from waiting/demo to live physical tracking.
- [ ] AR content is hidden when the physical reference marker is absent.
- [ ] AR content is anchored to the physical reference marker.
- [ ] Moving a physical piece changes the lesson result where applicable.
- [ ] Removing a piece updates the result.
- [ ] 3D / Rotate / Zoom / Info / Reset controls work.
- [ ] Fullscreen works on the IFP.
- [ ] No console-breaking errors occur during start/stop/switch.

## Accuracy gate

For measurement lessons (Rangometry, Mensuration, Measuring Jug, Graph, Geoboard, etc.), record the **actual physical dimensions of the kit** before claiming real-world units. Do not infer centimetres or millilitres from arbitrary camera coordinates.
