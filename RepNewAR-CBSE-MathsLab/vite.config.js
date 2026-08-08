import { defineConfig } from 'vite';

// AprilTag WASM is loaded by the runtime detector from a pinned CDN asset.
// No Vite WASM plugin is required, which keeps the production dependency tree
// smaller and avoids bundler-specific WebAssembly failures.
export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          vendor: ['@tweenjs/tween.js']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
