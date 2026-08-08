# RepNewAR — Final Classroom Deployment Guide

## 1. Requirements
- Windows 10/11
- Node.js 18+ recommended
- USB webcam
- Interactive Flat Panel / external display
- Printed AprilTag 36h11 markers
- Physical Maths Lab kits

## 2. First installation
Open PowerShell in this folder:

```powershell
npm install
npm run verify
npm run dev
```

Open `http://localhost:3000` in Chrome or Edge.

## 3. Camera setup
1. Connect the USB webcam.
2. Open Teacher Setup.
3. Select the webcam.
4. Allow camera permission.
5. Set the printed marker's black-square size in millimetres.
6. Keep the camera fixed and pointed down at the activity table.

## 4. Classroom workflow
1. Select a lesson.
2. Place the required physical kit pieces on the table.
3. Place the lesson's printed markers on the pieces.
4. Start the lesson.
5. Wait for LIVE PHYSICAL TRACKING.
6. Move the physical piece and verify the AR result follows it.
7. Use fullscreen mode on the IFP.

## 5. Safety / reliability
- Do not claim a physical measurement is accurate in centimetres, millilitres, etc. until the real kit has been calibrated.
- Keep the complete marker inside the camera frame.
- Avoid glare and shadows on markers.
- Use matte white paper where possible.
- Keep the webcam height and angle consistent between lessons.

## 6. Troubleshooting
**Waiting for markers:** check camera permission, lighting, marker family (AprilTag 36h11), and that the full black square is visible.

**AR appears before tracking:** reload and confirm the lesson reports WAITING FOR PHYSICAL MARKERS; production content should appear only after its anchor marker is detected.

**Lesson does not open:** run `npm run verify`, then restart Vite.
