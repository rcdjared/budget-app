/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      devOptions: {
        enabled: false,
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/*worker-*.js", "**/ort-wasm-*.wasm", "**/lib-*.js", "**/resolve-*.js", "**/capability-*.js", "**/embedder-*.js", "**/intentIndex-*.js", "**/llmParser-*.js"],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/assets/")
              && (/\.wasm$/u.test(url.pathname) || /(?:worker-|lib-|resolve-|capability-|embedder-|intentIndex-|llmParser-)[^/]+\.js$/u.test(url.pathname)),
            handler: "CacheFirst",
            options: {
              cacheName: "kupi-optional-nlu-runtime-v1",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: "Kupit",
        short_name: "Kupit",
        description: "Offline-first personal budgeting app for Filipinos",
        theme_color: "#019B51",
        background_color: "#F8FAF9",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
