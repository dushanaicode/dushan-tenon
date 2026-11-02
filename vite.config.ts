import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  cacheDir: "Temp/vite-cache",
  clearScreen: false,
  server: {
    host: "localhost",
    port: 17430,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/Temp/**"] },
  },
  build: { outDir: "Temp/web-dist" },
  test: {
    environment: "happy-dom",
    fsModuleCachePath: "Temp/vitest-cache",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/app/test-setup.ts"],
    coverage: { reportsDirectory: "Temp/coverage" },
  },
});
