/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json';

export default defineConfig({
  base: '/CzechMate/',
  build: {
    // ExcelJS is a lazily loaded ~940 kB chunk, only fetched when exporting.
    chunkSizeWarningLimit: 1000
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'templates/*.csv'],
      manifest: {
        name: 'CzechMate 捷適旅',
        short_name: 'CzechMate',
        description: '捷克交換生活的資源庫與記帳',
        lang: 'zh-Hant',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#344E41',
        background_color: '#F5F3EB',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,csv}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/mockup\//]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
