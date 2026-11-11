import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { indexedDB } from 'fake-indexeddb';

// Set global IndexedDB before any test imports Dexie
(globalThis as { indexedDB: unknown }).indexedDB = indexedDB;

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/.*/,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'api-cache',
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
      includeAssets: [
        'pwa-192x192.svg',
        'pwa-512x512.svg',
        'pwa-maskable-192x192.svg',
        'pwa-maskable-512x512.svg',
        'pwa-screenshot-1280x720.svg',
      ],
      manifest: {
        id: '/',
        name: 'Stabsstöd',
        short_name: 'Stabsstöd',
        description: 'Incident management staff support system',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        orientation: 'portrait',
        scope: '/',
        lang: 'sv',
        dir: 'ltr',
        categories: ['utilities', 'productivity'],
        icons: [
          {
            src: '/pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/pwa-maskable-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'maskable'
          },
          {
            src: '/pwa-maskable-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ],
        screenshots: [
          {
            src: '/pwa-screenshot-1280x720.svg',
            sizes: '1280x720',
            type: 'image/svg+xml',
            label: 'Stabsstöd - Incident workspace'
          }
        ],
        shortcuts: [
          {
            name: 'Incidents',
            short_name: 'Incidents',
            url: '/incidents',
            icons: [{ src: '/pwa-192x192.svg', sizes: '192x192' }]
          },
          {
            name: 'Logbook',
            short_name: 'Logbook',
            url: '/incidents/:id',
            icons: [{ src: '/pwa-192x192.svg', sizes: '192x192' }]
          }
        ]
      },
    }),
  ],
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
