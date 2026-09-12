import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4820",
      // the review tab's iframe loads the agent-written HTML from the server's own path, not /api
      "/review": "http://127.0.0.1:4820",
    },
  },
});
