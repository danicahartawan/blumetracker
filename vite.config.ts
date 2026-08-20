import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/apps": "http://localhost:8787",
    },
  },
  plugins: [
    react(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "server" },
      config: {
        main: "./worker/index.ts",
        compatibility_date: "2026-08-14",
        assets: {
          binding: "ASSETS",
          not_found_handling: "none",
        },
      },
    }),
  ],
});
