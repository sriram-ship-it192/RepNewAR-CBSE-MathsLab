# AR Educational Platform Architecture

This document describes the architecture of the AR Educational Platform.

## Architectural Layers

The system is divided into four distinct layers, each with a clearly defined responsibility.

| Layer | Responsibility | Key Modules |
| :--- | :--- | :--- |
| **Tracking** | Camera input, AprilTag detection via WASM, marker generation | `CameraFeed`, `AprilTagDetector`, `TrackerManager`, `MarkerGenerator` |
| **Rendering** | WebGL scene, 3D model loading, anchor management, lighting | `SceneManager`, `ObjectLoader`, `AnchorManager`, `Lighting` |
| **Content** | Lesson orchestration, formula calculations, animation tweening | `LessonManager`, `InteractionSystem`, `FormulaEngine`, `AnimationEngine` |
| **UI/UX** | HTML overlays, start screen, instructional text | `UIOverlay`, `StartScreen` |

## Core Communication

All inter-layer communication flows through the `EventBus` singleton. This ensures zero hard dependencies between modules.

## Data Flow

The data flow is unidirectional. The `CameraFeed` captures frames, the `AprilTagDetector` processes them via WebAssembly, and the `TrackerManager` emits `TAG_POSE_UPDATED` events. The `AnchorManager` consumes these events to update 3D object transforms, while the `LessonManager` reacts to trigger animations or formula calculations.

## Lesson Plugin Interface

Every lesson must implement the `ILesson` interface with two methods: `init(context)` and `cleanup()`. The `LessonManager` dynamically imports lesson modules at runtime. No core engine changes are required to add a new lesson.

## Tracking Pipeline

The tracking pipeline uses the official AprilTag WebAssembly implementation for maximum detection performance. Frame throttling is applied to maintain a stable 60fps render loop. Pose data is smoothed using exponential moving averages to reduce jitter.

## Performance Strategy

WebAssembly handles all image processing on the main thread without blocking the render loop. The Three.js renderer and the tracker share a single WebGL context. 3D models are served in Draco-compressed GLTF/GLB format with KTX2-compressed textures.
