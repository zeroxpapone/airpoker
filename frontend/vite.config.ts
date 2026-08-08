import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Everything below is about CACHING, not about shrinking the first load: these
  // chunks are all needed to boot, so a cold visit downloads the same bytes either
  // way. What changes is what a *returning* visitor re-downloads after a deploy.
  // Previously app code and all of firebase/react/i18n lived in one ~1.1 MB hashed
  // file, so editing a single line invalidated the whole thing. Split out, a normal
  // deploy only invalidates the app chunk; the vendor chunks keep their hash and stay
  // in cache. That matters here because firebase.json marks hashed assets
  // immutable-cached, and ReloadPrompt.tsx polls for new deploys every 15 minutes —
  // installed sessions pick up releases often, and each one paid full price before.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Firestore is by far the largest single dependency and the one whose
          // version moves least often.
          'vendor-firestore': ['firebase/firestore'],
          'vendor-firebase': ['firebase/app', 'firebase/auth'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      'spikier-sharen-endermic.ngrok-free.dev'
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon-airpoker.ico', 'favicon-airpoker-32x32.png', 'android-chrome-192x192.png'],
      manifest: {
        name: 'AirPoker',
        short_name: 'AirPoker',
        description: 'Virtual Chips for Live Poker',
        theme_color: '#0f172a',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait',
        id: '/',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
