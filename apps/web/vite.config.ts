import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { indexedDB } from 'fake-indexeddb';

// Set global IndexedDB before any test imports Dexie
(globalThis as { indexedDB: unknown }).indexedDB = indexedDB;

export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testSetup.ts'],
    passWithNoTests: true,
    resolve: {
      alias: {
        '@stabsstod/shared': '/home/calzon/projects/stabsstod/packages/shared/src/index.ts',
      },
    },
  },
});
