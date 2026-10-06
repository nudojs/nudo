import { defineConfig } from "vitest/config";
import { vitestAlias } from "./scripts/workspace-aliases.mjs";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // CI 的 --changed <base> 走模块图选测试；下图不可见的读取面
    // （fs 读 fixture / 文档 / 工作流、运行时动态 import）必须在此
    // 列为强制全量触发器，否则那些 PR 会假绿。覆盖默认值
    // （['**/package.json', '**/{vitest,vite}.config.*']），故显式保留。
    // 注意：vitest 把 git diff 输出 resolve 成绝对路径后再做
    // picomatch 匹配——所有 glob 必须以 **/ 开头，否则相对
    // 模式永远匹配不上（默认值即此形态）。
    //   **/pnpm-lock.yaml      依赖变 → real-package 扫描测试失效
    //   **/docs/examples/**    check-mini-repo 等经 readFileSync 读金标
    //   **/packages/website/** docs-coverage / home-stats / seo 等读 md/json
    //   **/scripts/**          gate-major 等经 execFileSync 调脚本
    //   **/.github/workflows/** release-tag-whitelist 读 release.yml
    // 模块图已覆盖：包源码（env-loader 静态 import @nudojs/env/*）、
    // differential 语料（静态 import corpus/batch*.ts）。
    forceRerunTriggers: [
      "**/package.json",
      "**/{vitest,vite}.config.*",
      "**/pnpm-lock.yaml",
      "**/docs/examples/**",
      "**/packages/website/**",
      "**/scripts/**",
      "**/.github/workflows/**",
    ],
    // lodash harvest + relationFn 图会顶爆默认 isolate 堆
    pool: "forks",
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["json", "text-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts"],
      // 防止重构 silently 丢覆盖；数字按当前基线取整，只升不降。
      // 全局阈值是安全网；下面的 per-package glob 防止薄包躲在 core 体量下
      // 被静默拖垮（env/harvester/vite-plugin/parser 测试面薄）。
      // Vitest 2+/5 thresholds glob：`thresholds['<glob>']` 对匹配文件单独
      // 聚合，glob 之外仍受全局阈值约束（全局对所有文件生效）。
      // 基线（2025-09，lines/stmts/branch/funcs）：
      //   env        72/66/46/68   floors 65/58/40/60
      //   harvester  82/78/70/88   floors 75/70/62/80
      //   vite-plugin 86/85/72/81 floors 78/78/65/72
      //   parser     89/85/74/90   floors 80/78/68/82
      // nudojs 无 per-package floor（走全局阈值）。
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
        "packages/env/**": {
          lines: 65,
          functions: 60,
          branches: 40,
          statements: 58,
        },
        "packages/harvester/**": {
          lines: 75,
          functions: 80,
          branches: 62,
          statements: 70,
        },
        "packages/vite-plugin/**": {
          lines: 78,
          functions: 72,
          branches: 65,
          statements: 78,
        },
        "packages/parser/**": {
          lines: 80,
          functions: 82,
          branches: 68,
          statements: 78,
        },
      },
    },
  },
  resolve: {
    // packages/*/package.json exports → dist/（发布产物）。测试走 src 别名，
    // 无需先 build；与 CI「lint / build / test 独立」一致。
    // 别名表唯一来源：scripts/workspace-aliases.mjs（最长前缀优先，
    // 保证 `@nudojs/core/exec` 不被 `@nudojs/core` 前缀吞掉）。
    // evaluator transpile 注入 `@nudojs/core/exec` —— 测试必须走 src，否则
    // 与 dist 旧 runtime 分叉（mutator/fork 修复对测试不可见）。
    alias: vitestAlias(new URL(".", import.meta.url).pathname),
  },
});
