# RepNewAR — GitHub Pages Deployment

This release is prepared for HTTPS hosting on GitHub Pages. HTTPS is important because browser camera access is restricted to secure contexts (localhost is also allowed during development).

## 1. Upload/push the project

Push the contents of this folder to the repository's `main` branch.

## 2. Enable GitHub Pages

In the repository:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

The included workflow `.github/workflows/deploy-pages.yml` then:

1. installs dependencies with `npm ci`
2. verifies all 26 CBSE lessons
3. creates the Vite production build
4. publishes `dist/` to GitHub Pages

## 3. Camera permission

Open the published HTTPS URL in a supported browser and allow camera access when prompted.

For classroom use, connect the USB webcam first, then open **Teacher Setup** and select the correct camera.

## 4. IFP setup

Use the browser's fullscreen mode on the Interactive Flat Panel. Keep the webcam aimed downward at the physical kit and ensure the complete AprilTag markers are visible.

## 5. Local development remains unchanged

```powershell
npm install
npm run verify
npm run dev
```

## 6. Release gate

Before pushing a release:

```powershell
npm run qa:all
```

The GitHub Action repeats the important verification/build steps on every push to `main`.
