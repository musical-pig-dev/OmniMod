import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "browsers/chrome");
const entry = path.resolve(root, "index.html");

export default defineConfig({
  root,
  publicDir: path.resolve(root, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  base: "./",
  build: {
    // Absolute entry. Vite 8 otherwise asks rolldown for a bare "index.html"
    // and fails with UNRESOLVED_ENTRY when the shell is not the project root.
    rollupOptions: { input: entry },
    outDir: path.resolve(import.meta.dirname, "dist/chrome"),
    emptyOutDir: true,
  },
});
