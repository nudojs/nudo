// dx 指标对外发布钉面（vs-typescript.md 的 <!-- dx-metrics:begin/end --> 生成块）。
// 实跑 scripts/dx-metrics.mjs --json（默认 --mode both：tsx + dist 双口径同场景）后断言：
// ① fix-rate === 1（硬钉，不放松）—— 文档块发布的「每条文档修复路径都真能修绿」主张必须可复现；
//    fix-rate 无计时依赖，红了就是引擎/错误面真回归，不是机器噪声。顶层 fixRate 聚合
//    **所有实际执行的口径**——dist 执行且 <1 同样拉红（src 与构建产物的 drift 信号）；
//    tsx 口径恒可执行（canonical），单独钉 byMode.tsx.fixRate === 1；
// ② time-to-green（硬钉 sanity 上界 + 目标可区分提示）—— rev 5 运营目标是 avg < 2s，
//    但 tsx 口径由本地 tsx 冷启动主导：本机单次 check ≈1.3s（场景 = 红+绿两次 check ⇒ ≈2.7s）、
//    2026-09 基线机单次 ≈0.9s、CI runner 更慢；dist 口径跳过 tsx 冷启动（本机 ≈0.55s）。
//    硬钉 2000ms 在慢机器上必然假红（同类机器因子问题见 benchmark-gate-noise.test.ts
//    与 benchmark gate 的 --allow-uniform-shift），且 dx-metrics.mjs 自身的 exit 分级也只把
//    fix-rate<1 当失败、time-to-green 不影响退出码。因此**逐口径**硬钉 < 10s sanity 上界
//    （≈本机 4 倍：修复环未失控、无多余轮次）；任一口径超 2s 目标时 console.warn 给出
//    **可区分**的提示（机器慢，非文档漂移），不判失败；
// ③ en+zh 生成块（硬钉）—— 标记对、生成日期、模式列表头、tsx 行、目标行、fix-rate 数值与
//    实跑一致。dist 行与实跑可用性**一致**：实跑执行了 dist ⇒ dist 行必须是数值行且含实跑
//    fix-rate；实跑 honest-skip ⇒ dist 行必须如实标 skipped/跳过（不许伪造数字，也不许
//    过期地宣称 skip）。time-to-green 的**秒数刻意不钉**——文档块保留实测值即可；钉秒数
//    必然 flaky。fix-rate 才是跨机器可钉的主张。
// 注意：本测试要求先 `pnpm run build`（dist 口径需要 packages/nudojs/dist/index.js）——与仓库
// build-before-test 约定一致。spawn node→pnpm→tsx + node→dist 子进程链（约 10s），勿与其他
// heavy job 并发跑。
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(repoRoot, "scripts", "dx-metrics.mjs");
const EN_DOC = join(repoRoot, "packages", "website", "docs", "guides", "vs-typescript.md");
const ZH_DOC = join(
  repoRoot,
  "packages",
  "website",
  "i18n",
  "zh-Hans",
  "docusaurus-plugin-content-docs",
  "current",
  "guides",
  "vs-typescript.md",
);

type ModeAggregate = {
  fixRate: number;
  avgTimeToGreenMs: number;
  maxTimeToGreenMs: number;
};

type DxReport = {
  mode: string;
  modesExecuted: string[];
  skipped: Array<{ mode: string; reason: string }>;
  fixRate: number;
  avgTimeToGreenMs: number;
  maxTimeToGreenMs: number;
  byMode: Record<string, ModeAggregate>;
  samples: Array<{ mode: string; name: string; fixRate: number; timeToGreenMs: number }>;
};

let report: DxReport;

beforeAll(() => {
  // dx-metrics.mjs 在 fix-rate<1 时 exit 1——用 spawnSync（不抛错）拿 stdout，
  // 让下面的断言给出可区分的失败信息，而不是钩子直接崩掉看不到数值。
  const r = spawnSync("node", [SCRIPT, "--json"], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(r.error, `dx-metrics spawn failed: ${String(r.error)}`).toBeUndefined();
  const stdout = r.stdout ?? "";
  expect(stdout, `dx-metrics produced no JSON on stdout (status=${r.status})`).toContain("fixRate");
  report = JSON.parse(stdout) as DxReport;
}, 120_000);

describe("dx-metrics publication (vs-typescript.md generated block)", () => {
  it("fix-rate === 1 — the published claim (every documented fix path goes green) reproduces in every executed mode", () => {
    // tsx 口径恒可执行（canonical 参照）：必须在场且全绿。
    expect(
      report.modesExecuted,
      "tsx mode was not executed — it has no dist dependency and must always run (canonical reference)",
    ).toContain("tsx");
    expect(
      report.byMode.tsx?.fixRate,
      `[docs claim] tsx fix-rate ${report.byMode.tsx?.fixRate} ≠ 1 — a documented fix path no longer goes green (engine or error-face regression); the "100%" published in vs-typescript.md is not reproducible. This is NOT machine noise — fix-rate has no timing dependency.`,
    ).toBe(1);
    // 顶层聚合覆盖所有实际执行口径：dist 执行且 <1（构建产物与 src 的 drift）同样拉红。
    expect(
      report.fixRate,
      `[docs claim] aggregate fix-rate ${report.fixRate} ≠ 1 across executed modes [${report.modesExecuted.join(", ")}] — a documented fix path no longer goes green in some executed mode (engine, error-face, or src↔dist drift); the "100%" published in vs-typescript.md is not reproducible. This is NOT machine noise — fix-rate has no timing dependency.`,
    ).toBe(1);
  });

  it("per-mode avg time-to-green sane (< 10 s); the 2 s ops target is machine-dependent and reported, not gated", () => {
    // 硬钉 sanity 上界（逐口径，聚合会被快口径稀释）：修复环完整走完且无失控（10s ≈ 本机 4 倍余量）。
    expect(report.modesExecuted.length, "no mode was executed — nothing measured").toBeGreaterThan(0);
    for (const m of report.modesExecuted) {
      const avg = report.byMode[m]?.avgTimeToGreenMs;
      expect(
        avg,
        `repair loop looks broken in mode "${m}": avg time-to-green ${avg}ms ≥ 10000ms (fix-rate arm above says whether the paths still go green)`,
      ).toBeLessThan(10_000);
      // 超 2s 目标 → 可区分提示（机器慢，非文档漂移），不判失败。理由见文件头注释：
      // tsx 冷启动主导 + benchmark gate 机器因子先例 + dx-metrics.mjs 自身 exit 分级。
      if (avg >= 2000) {
        console.warn(
          `[perf target] ${m}: avg time-to-green ${avg}ms ≥ 2000ms — machine-dependent timing (2 CLI spawns per scenario), NOT a docs-drift failure; the published block's seconds are not pinned by any assertion. Re-run on an idle machine before treating it as an engine regression.`,
        );
      }
    }
  });

  it("en+zh generated blocks exist, have dual-mode structure, and match the live run (incl. honest-skip status)", () => {
    const livePct = `${(report.fixRate * 100).toFixed(0)}%`;
    const distSkipped = report.skipped.some((s) => s.mode === "dist");
    const distExecuted = report.modesExecuted.includes("dist");
    expect(distSkipped !== distExecuted, "dist is both skipped and executed — contradictory report").toBe(true);
    for (const [locale, path, modeHeader, tsxRowRe, distRowRe, skipWord] of [
      ["en", EN_DOC, "| mode |", /^\| tsx \(src\).*$/m, /^\| dist \(built\).*$/m, "skipped"],
      ["zh", ZH_DOC, "| 模式 |", /^\| tsx（源码）.*$/m, /^\| dist（构建产物）.*$/m, "跳过"],
    ] as const) {
      const md = readFileSync(path, "utf-8");
      const begin = md.indexOf("<!-- dx-metrics:begin -->");
      const end = md.indexOf("<!-- dx-metrics:end -->");
      expect(begin, `${locale}: <!-- dx-metrics:begin --> marker missing in ${path}`).toBeGreaterThanOrEqual(0);
      expect(end, `${locale}: <!-- dx-metrics:end --> marker missing (or before begin) in ${path}`).toBeGreaterThan(
        begin,
      );
      const block = md.slice(begin, end + "<!-- dx-metrics:end -->".length);
      // 结构：生成日期行 + 双口径模式表（mode 列 + tsx 行 + dist 行）+ 目标行（< 2 s）。
      // 秒数刻意不做任何比对——机器相关量，见文件头注释。
      expect(block, `${locale}: no generated-date line in the block`).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block, `${locale}: no fix-rate / time-to-green table header`).toMatch(/fix-rate/);
      expect(block, `${locale}: no time-to-green column`).toMatch(/time-to-green/);
      expect(block, `${locale}: no mode column in the table header (dual-mode structure)`).toContain(modeHeader);
      expect(block, `${locale}: no tsx row`).toMatch(tsxRowRe);
      expect(block, `${locale}: no dist row (must exist even when skipped — honest annotation)`).toMatch(distRowRe);
      expect(block, `${locale}: no "< 2 s" target line`).toContain("< 2 s");
      // fix-rate 数值与实跑一致——发布块唯一跨机器可钉的主张。tsx 行必须有实跑数值。
      expect(
        block,
        `${locale}: published fix-rate does not match the live run (${livePct}) — regenerate with \`pnpm run dx-metrics -- --md --lang both\` (same numbers for both locales) and re-paste the block`,
      ).toContain(livePct);
      const tsxLine = block.match(tsxRowRe)![0];
      expect(tsxLine, `${locale}: tsx row fix-rate does not match the live run`).toContain(livePct);
      // dist 行与实跑可用性一致：执行 ⇒ 数值行含实跑 fix-rate；skip ⇒ 如实标注（不伪造、不过期）。
      const distLine = block.match(distRowRe)![0];
      if (distExecuted) {
        expect(distLine, `${locale}: dist row must carry the live fix-rate (${livePct})`).toContain(livePct);
      } else {
        expect(
          distLine,
          `${locale}: live run honest-skipped dist, but the published dist row claims numbers — regenerate the block (skip row must be honest); or run \`pnpm run build\` and regenerate with real dist numbers`,
        ).toContain(skipWord);
      }
    }
  });
});
