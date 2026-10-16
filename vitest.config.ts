import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    include: ["src/lib/omnimod/**/*.test.ts", "src/components/omnimod/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/lib/omnimod/**/*.ts", "src/components/omnimod/**/*.tsx"],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
