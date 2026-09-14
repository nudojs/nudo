import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    exec: "src/algebra/exec/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
