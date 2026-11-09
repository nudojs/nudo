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
      // 基线（2025-09，lines/stmts/branch/funcs）：
      //   env        72/66/46/68   floors 65/58/40/60
      //   harvester  82/78/70/88   floors 75/70/62/80
      //   vite-plugin 86/85/72/81 floors 78/78/65/72
      //   parser     89/85/74/90   floors 80/78/68/82
      // 2026-11-05：core/service/lsp/nudojs 补齐起步 floor（见下）；floors 只升不降。
      thresholds: coverageGate
        ? {
            lines: 70,
            functions: 70,
            branches: 65,
            statements: 70,
            // 四大包起步地板（2026-11-05）：core/service/lsp/nudojs 占代码大头，
            // 原先只有四个薄包有独立下限，大包会躲在全局阈值下被静默拖垮。
            // 这里只兜「覆盖率腰斩」级倒退，不是质量证明；全量夜间基线刷新后
            // 按 pnpm run coverage:floors 的建议值上调，只升不降。
            "packages/core/**": {
              lines: 60,
              functions: 60,
              branches: 50,
              statements: 60,
            },
            "packages/service/**": {
              lines: 60,
              functions: 60,
              branches: 50,
              statements: 60,
            },
            "packages/lsp/**": {
              lines: 55,
              functions: 55,
              branches: 45,
              statements: 55,
            },
            "packages/nudojs/**": {
              lines: 55,
              functions: 55,
              branches: 45,
              statements: 55,
            },
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
