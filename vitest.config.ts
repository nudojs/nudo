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
      "@nudojs/cli/evaluator": new URL(
        "./packages/cli/src/evaluator-api.ts",
        import.meta.url,
      ).pathname,
      "@nudojs/cli": new URL("./packages/cli/src", import.meta.url).pathname,
      "@nudojs/service": new URL("./packages/service/src", import.meta.url)
        .pathname,
      "@nudojs/env/es": new URL("./packages/env/src/es.ts", import.meta.url)
        .pathname,
      "@nudojs/env/web": new URL("./packages/env/src/web.ts", import.meta.url)
        .pathname,
      "@nudojs/env/node": new URL("./packages/env/src/node.ts", import.meta.url)
        .pathname,
    },
  },
});
