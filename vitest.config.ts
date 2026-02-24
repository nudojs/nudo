import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@nudojs/core": new URL("./packages/core/src", import.meta.url)
        .pathname,
      "@nudojs/parser": new URL("./packages/parser/src", import.meta.url)
        .pathname,
    },
  },
});
