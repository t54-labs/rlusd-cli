import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/**/index.ts"],
    },
    testTimeout: 30000,
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
