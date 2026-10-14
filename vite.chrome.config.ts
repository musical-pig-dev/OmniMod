import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  publicDir: "browsers/chrome/public",
  build: {
    outDir: "dist/chrome",
    rollupOptions: {
      input: resolve(__dirname, "browsers/chrome/index.html"),
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
