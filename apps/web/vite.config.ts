import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content-Security-Policy for the production build (GitHub Pages cannot set
 * headers, so it goes in a <meta> tag). Dev mode is left without CSP because
 * Vite injects inline scripts for HMR.
 */
function cspPlugin(apiOrigin: string): Plugin {
  const policy = [
    "default-src 'self'",
    // hash-wasm (Argon2id) and pdf.js decoders instantiate WebAssembly
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "frame-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
  ].join('; ');
  return {
    name: 'mynotes-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/** GitHub Pages serves 404.html for unknown paths: reuse the SPA shell so deep links work. */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mynotes-spa-fallback',
    apply: 'build',
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: () => {
      const index = resolve(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // e.g. "/mynotes/" for https://user.github.io/mynotes/ ; "/" for a custom domain
  const base = env.BASE_PATH || '/';
  const apiUrl = env.VITE_API_URL || 'http://localhost:8787';
  const apiOrigin = new URL(apiUrl).origin;

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      cspPlugin(apiOrigin),
      spaFallback(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/*.png', 'icons/*.svg'],
        manifest: {
          name: 'MyNotes',
          short_name: 'MyNotes',
          description: 'Notas, leituras e estudos em um só lugar',
          lang: 'pt-BR',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'any',
          background_color: '#f7f6f3',
          theme_color: '#f7f6f3',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: `${base}index.html`,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
          globIgnores: ['pdfjs/**'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // API responses are private and always fetched from the network (never cached
          // by the service worker). pdf.js fonts/cmaps are cached on first use.
          runtimeCaching: [
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/pdfjs/'),
              handler: 'CacheFirst',
              options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 400 } },
            },
          ],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173 },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1600,
    },
    worker: { format: 'es' },
  };
});
