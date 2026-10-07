import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { frame } from '@agent-native/frame/vite';
import { browserBoundary } from '../../scripts/vite-browser-boundary.ts';

const repository = resolve(import.meta.dirname, '../..');
const wiring = await frame({
  appSource: resolve(import.meta.dirname, 'src'),
  configPath: resolve(repository, 'app.config.json'),
  outRoot: resolve(repository, 'dist/web'),
});

// Output goes to dist/web/<application> with flat file names: the local authority serves a flat
// directory under a strict CSP (no inline scripts or styles), and Electron packages it unchanged.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [...wiring.plugins, browserBoundary(repository), react(), tailwindcss()],
  build: {
    outDir: wiring.outDir,
    emptyOutDir: true,
    assetsDir: '',
    sourcemap: true,
    modulePreload: { polyfill: false },
    // Served from loopback or the packaged app, so one bundle beats extra round trips.
    chunkSizeWarningLimit: 1_000,
  },
});
