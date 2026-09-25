import { defineConfig } from "vitest/config";
import { vitestAlias } from "./scripts/workspace-aliases.mjs";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
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
      // 被静默拖垮（env/harvester/vite-plugin/parser/cli 测试面薄）。
      // Vitest 2+/5 thresholds glob：`thresholds['<glob>']` 对匹配文件单独
      // 聚合，glob 之外仍受全局阈值约束（全局对所有文件生效）。
      // 基线（2025-09，lines/stmts/branch/funcs）：
      //   env        72/66/46/68   floors 65/58/40/60
      //   harvester  82/78/70/88   floors 75/70/62/80
      //   vite-plugin 86/85/72/81 floors 78/78/65/72
      //   parser     89/85/74/90   floors 80/78/68/82
      //   cli        21/20/16/22   floors 18/18/14/20（命令面经子进程测，in-process 偏低）
      // nudojs 无 packages/nudojs/src/**（仅 bin/），不设 floor。
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
        "packages/cli/**": {
          lines: 18,
          functions: 20,
          branches: 14,
          statements: 18,
        },
      },
    },
  },
  resolve: {
    // packages/*/package.json exports → dist/（发布产物）。测试走 src 别名，
    // 无需先 build；与 CI「lint / build / test 独立」一致。
    // 别名表唯一来源：scripts/workspace-aliases.mjs（最长前缀优先，
    // 保证 `@nudojs/core/exec` 不被 `@nudojs/core` 前缀吞掉）。
    // B-path transpile 注入 `@nudojs/core/exec` —— 测试必须走 src，否则
    // 与 dist 旧 runtime 分叉（mutator/fork 修复对测试不可见）。
    alias: vitestAlias(new URL(".", import.meta.url).pathname),
  },
});
