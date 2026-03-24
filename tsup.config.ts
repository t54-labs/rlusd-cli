import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "bin/rlusd.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
