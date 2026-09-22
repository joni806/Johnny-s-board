import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const mathliveRoot = dirname(require.resolve('mathlive'))
const mathliveFonts = join(mathliveRoot, 'fonts')

/**
 * מגיש את פונטי MathLive מתוך האפליקציה עצמה ולא מ-CDN.
 *
 * MathLive טוען את הפונטים שלו בזמן ריצה, וכשהנתיב לא נמצא הוא נופל
 * ל-unpkg. המשמעות היא שבמצב אופליין — בדיוק במבחן בלי רשת — המקלדת
 * המתמטית נשברת. הפלאגין מעתיק את הפונטים לתוך התוצר, וכך הם גם נכנסים
 * ל-precache של ה-Service Worker.
 */
const mathliveAssets = () => ({
    name: 'mathlive-assets',
    async configureServer(server) {
        server.middlewares.use('/mathlive/fonts', async (req, res, next) => {
            const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '')
            if (!/^[\w.-]+\.(woff2?|ttf)$/.test(name)) return next()
            try {
                const body = await readFile(join(mathliveFonts, name))
                res.setHeader('Content-Type', name.endsWith('.woff2') ? 'font/woff2' : 'font/woff')
                res.end(body)
            } catch { next() }
        })
    },
    async generateBundle() {
        const files = await readdir(mathliveFonts)
        for (const name of files) {
            if (!/\.(woff2?|ttf)$/.test(name)) continue
            this.emitFile({
                type: 'asset',
                fileName: `mathlive/fonts/${name}`,
                source: await readFile(join(mathliveFonts, name)),
            })
        }
    },
})

export default defineConfig({
  plugins: [
    react(),
    mathliveAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'לוח פיזיקה',
        short_name: 'לוח פיזיקה',
        description: 'לוח ציור מתמטי חכם לפיזיקה ולמתמטיקה',
        theme_color: '#1e3d32',
        background_color: '#1e3d32',
        display: 'standalone',
        orientation: 'any',
        dir: 'ltr', // הלוח שלך בנוי משמאל לימין ביסודו, התפריטים הם rtl
        lang: 'he',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,wasm}'],
        // התוצר כולל את מנוע החישוב ואת הפונטים, ולכן התקרה הורמה
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // הגדרות שמירה בזיכרון לספריות חיצוניות (כמו פונטים ו-MathLive)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } }
          },
          {
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'unpkg-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } }
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'jsdelivr-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ]
})
