import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    exec: "src/algebra/exec/index.ts",
    internal: "src/internal.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
