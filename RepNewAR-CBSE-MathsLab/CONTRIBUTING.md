# Contributing to the AR Educational Platform

## Adding a New Lesson

Every lesson is a self-contained plugin that implements the `ILesson` interface. To add a new lesson:

1. Create a new file in `src/content/lessons/` (e.g., `cylinder.js`).
2. Export an `init(context)` function that loads your 3D model, registers anchors, and sets up interactions using the provided `LessonContext` object.
3. Export a `cleanup()` function that removes all resources added by `init()`.
4. Place the corresponding GLTF model in `public/models/` and any AprilTag images in `public/tags/`.

The `LessonManager` will dynamically import your module at runtime. You do not need to modify any core engine files.

## Module Guidelines

Every module must adhere to the Single Responsibility Principle. If a module grows beyond its defined responsibility, split it into two or more modules. Communication between modules must always occur through the `EventBus`. Direct imports between layers (e.g., a tracking module importing a rendering module) are prohibited.

## Build and Deploy

The project uses Vite for building. The `base` option in `vite.config.js` is set to `./` for GitHub Pages compatibility. Run `npm run build` to produce a static build in the `dist/` directory.
