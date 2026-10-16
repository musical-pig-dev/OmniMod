import { execFileSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vite";

const root = path.resolve(import.meta.dirname, "browsers/chrome");
const entry = path.resolve(root, "index.html");

execFileSync(process.execPath, [path.resolve(process.cwd(), "scripts/ensure-tailwind-native.mjs")], {
  stdio: "inherit",
});

export default defineConfig(async () => {
  const plugin = "@vitejs/" + "plugin-react";
  const css = "@tailwindcss/" + "vite";
  const [{ default: react }, { default: tailwindcss }] = await Promise.all([import(plugin), import(css)]);
  return {
    root,
    publicDir: path.resolve(root, "public"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    base: "./",
    build: {
      rollupOptions: { input: entry },
      outDir: path.resolve(import.meta.dirname, "dist/chrome"),
      emptyOutDir: true,
    },
  };
});
