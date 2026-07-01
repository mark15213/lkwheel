import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "server/production.ts",
    outDir: "release/server",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
        format: "es"
      }
    }
  },
  ssr: {
    noExternal: true
  }
});
