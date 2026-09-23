import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // lodash harvest + relationFn 图会顶爆默认 isolate 堆
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=8192"],
      },
    },
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
      // B-path transpile 注入 `@nudojs/core/exec` —— 测试必须走 src，否则
      // 与 dist 旧 runtime 分叉（mutator/fork 修复对测试不可见）。
      "@nudojs/core/exec": new URL("./packages/core/src/algebra/exec/index.ts", import.meta.url)
        .pathname,
      "@nudojs/parser": new URL("./packages/parser/src", import.meta.url)
        .pathname,
      "@nudojs/service/evaluator": new URL(
        "./packages/service/src/evaluator/evaluator-api.ts",
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
