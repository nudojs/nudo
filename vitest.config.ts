import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["json"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      // packages/*/package.json exports → dist/（发布产物）。测试走 src 别名，
      // 无需先 build；与 CI「lint / build / test 独立」一致。
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
      "@nudojs/harvester": new URL(
        "./packages/harvester/src",
        import.meta.url,
      ).pathname,
      "@nudojs/lsp": new URL("./packages/lsp/src", import.meta.url).pathname,
      "@nudojs/env/es": new URL("./packages/env/src/es.ts", import.meta.url)
        .pathname,
      "@nudojs/env/web": new URL("./packages/env/src/web.ts", import.meta.url)
        .pathname,
      "@nudojs/env/node": new URL("./packages/env/src/node.ts", import.meta.url)
        .pathname,
    },
  },
});
