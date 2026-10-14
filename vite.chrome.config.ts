import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "browsers/chrome");

export default defineConfig({
  root,
  publicDir: path.resolve(root, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/chrome"),
    emptyOutDir: true,
  },
});
