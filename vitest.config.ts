import { defineConfig } from "vitest/config";
import { vitestAlias } from "./scripts/workspace-aliases.mjs";

// PR / --changed 覆盖率只出报告、不判全局阈值（子集天然低于全量基线）；
// 硬阈值仍由夜间全量 test-coverage 守。见 .github/workflows/ci.yml。
const coverageGate = process.env.NUDO_COVERAGE_THRESHOLDS !== "off";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // CI 的 --changed <base> 走模块图选测试；模块图看不到的读取面分两类：
    //   1. 全局配置/依赖（package.json / lockfile / vitest 配置）→ 本列表；
    //   2. 仓库级 fs 读取（docs / website / root scripts / benchmark /
    //      workflows）→ 独立的 `pnpm run test:fs-input` 套件（清单见
    //      scripts/fs-input-tests.mjs，CI 在增量路径上无条件执行）。
    // 不能把第 2 类按 project 配 trigger：vitest 的 forceRerunTriggers 是
    // NonProjectOptions，任何匹配都会重跑全部 specs，而不是只跑读取该文件
    // 的那个 project。故这里只留真正的全局面，避免 docs-only PR 跑 1711 个
    // 文件。
    // 注意：vitest 把 git diff 输出 resolve 成绝对路径后再做
    // picomatch 匹配——所有 glob 必须以 **/ 开头，否则相对
    // 模式永远匹配不上（默认值即此形态）。
    //   **/pnpm-lock.yaml           依赖变 → real-package 扫描测试失效
    //   **/packages/*/scripts/**    package-local 脚本被 vscode 测试直接
    //                               readFileSync（模块图不覆盖）
    // 模块图已覆盖：包源码（env-loader 静态 import @nudojs/env/*）、
    // differential 语料（静态 import corpus/batch*.ts）。
    forceRerunTriggers: [
      "**/package.json",
      "**/{vitest,vite}.config.*",
      "**/pnpm-lock.yaml",
      "**/packages/*/scripts/**",
    ],
    // lodash harvest + relationFn 图会顶爆默认 isolate 堆
    pool: "forks",
    maxWorkers: 4,
    // 默认 5s 是**单测**口径；CLI e2e（`nudojs/src/__tests__` 里 spawn
    // `tsx <cli src>` 的那批）每条用例 spawn 1–5 个 tsx 子进程，单次 ≈1.5–2.5s
    // ——在 4 worker / 2 core 的 CI shard 上会因 CPU 争用翻到 5s 以上（同一用例
    // 上一轮 2s 通过、下一轮超时，纯抖动）。故把默认放宽到 30s；更重的用例仍按
    // 需在 it 上显式 60s/120s。真 hang 仍会被兜住（只是晚 25s 报）。
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["json", "json-summary", "text-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts"],
      // 防止重构 silently 丢覆盖；数字按当前基线取整，只升不降。
      // 全局阈值是安全网；下面的 per-package glob 防止薄包躲在 core 体量下
      // 被静默拖垮（env/harvester/vite-plugin/parser 测试面薄）。
      // Vitest 2+/5 thresholds glob：`thresholds['<glob>']` 对匹配文件单独
      // 聚合，glob 之外仍受全局阈值约束（全局对所有文件生效）。
      // 2026-11-14 全量基线（1763 文件 / 17971 用例，`pnpm run coverage:floors`）：
      //   core       92.0/94.6/82.5/88.5   service    91.3/94.2/78.4/87.3
      //   lsp        88.8/93.1/74.8/83.7   nudojs     52.8/56.4/43.6/51.1
      //   env        88.4/90.8/71.6/83.4   harvester  89.3/94.5/76.3/85.3
      //   parser     92.4/93.1/80.2/88.0   vite-plugin 95.1/92.6/89.8/94.1
      // 本次按建议值（实测 −5 取整到 5）上调；nudojs 是**修正**：旧值
      // 55/55/45/55 高于实测（nightly 会红），改到 45/50/35/45。
      thresholds: coverageGate
        ? {
            lines: 70,
            functions: 70,
            branches: 65,
            statements: 70,
            "packages/core/**": {
              lines: 85,
              functions: 85,
              branches: 75,
              statements: 80,
            },
            "packages/service/**": {
              lines: 85,
              functions: 85,
              branches: 70,
              statements: 80,
            },
            "packages/lsp/**": {
              lines: 80,
              functions: 85,
              branches: 65,
              statements: 75,
            },
            "packages/nudojs/**": {
              lines: 45,
              functions: 50,
              branches: 35,
              statements: 45,
            },
            "packages/env/**": {
              lines: 80,
              functions: 85,
              branches: 65,
              statements: 75,
            },
            "packages/harvester/**": {
              lines: 80,
              functions: 85,
              branches: 70,
              statements: 80,
            },
            "packages/vite-plugin/**": {
              lines: 90,
              functions: 85,
              branches: 80,
              statements: 85,
            },
            "packages/parser/**": {
              lines: 85,
              functions: 85,
              branches: 75,
              statements: 80,
            },
          }
        : {},
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
