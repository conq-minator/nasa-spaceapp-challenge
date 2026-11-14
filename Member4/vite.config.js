import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Allow imports from ../web/src/core (M1 missionLogic.js) and ../Member2/src (M2 ray-cast).
  server: { fs: { allow: ['..'] } },
});
