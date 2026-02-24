import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@nudo/core": new URL("./packages/core/src", import.meta.url)
        .pathname,
      "@nudo/parser": new URL("./packages/parser/src", import.meta.url)
        .pathname,
    },
  },
});
