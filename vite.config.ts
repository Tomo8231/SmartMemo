import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages ではリポジトリ名のサブパス配下で配信されるため base を合わせる。
// 例: https://<user>.github.io/SmartMemo/
const base = '/SmartMemo/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'SmartMemo',
        short_name: 'SmartMemo',
        description: 'AI でタスクを自動整理するメモアプリ',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fafaf9',
        theme_color: '#D4622A',
        lang: 'ja',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // precache は初期表示に要るものだけ。スプライト（452 枚 / 12MB）・音源・
        // アイテム画像まで含めると、初回訪問でその全部を並列取得することになり
        // モバイル回線で待たされる。実際に画面へ出るメモモンは同時 1 体なので、
        // これらは下の runtimeCaching で「見たものから貯める」方式にする。
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        globIgnores: ['**/sprites/**', '**/items/**', '**/sounds/**'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
          {
            // スプライト・アイテム画像・写真。中身が変わらないので CacheFirst。
            urlPattern: ({ url }) => /\/(sprites|items)\/|\.(png|jpe?g)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'smartmemo-images',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/sounds/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'smartmemo-sounds',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
