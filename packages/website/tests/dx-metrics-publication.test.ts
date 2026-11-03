// dx 指标对外发布钉面（vs-typescript.md 的 <!-- dx-metrics:begin/end --> 生成块）。
// 实跑 scripts/dx-metrics.mjs --json 后断言：
// ① fix-rate === 1（硬钉）—— 文档块发布的「每条文档修复路径都真能修绿」主张必须可复现；
//    fix-rate 无计时依赖，红了就是引擎/错误面真回归，不是机器噪声；
// ② time-to-green（硬钉 sanity 上界 + 目标可区分提示）—— rev 5 运营目标是 avg < 2s，
//    但该量由本地 tsx 冷启动主导：本机单次 check ≈1.3s（场景 = 红+绿两次 check ⇒ ≈2.7s）、
//    2026-09 基线机单次 ≈0.9s、CI runner 更慢。硬钉 2000ms 在慢机器上必然假红（同类
//    机器因子问题见 benchmark-gate-noise.test.ts 与 benchmark gate 的 --allow-uniform-shift），
//    且 dx-metrics.mjs 自身的 exit 分级也只把 fix-rate<1 当失败、time-to-green 不影响退出码。
//    因此硬钉 < 10s sanity 上界（≈本机 4 倍：修复环未失控、无多余轮次）；超 2s 目标时
//    console.warn 给出**可区分**的提示（机器慢，非文档漂移），不判失败；
// ③ en+zh 生成块（硬钉）—— 标记对、生成日期、目标行、fix-rate 数值与实跑一致。
//    time-to-green 的**秒数刻意不钉**——文档块保留实测值即可；钉秒数必然 flaky。
//    fix-rate 才是跨机器可钉的主张。
// 注意：本测试 spawn node→pnpm→tsx 子进程链（约 10s），勿与其他 heavy job 并发跑。
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

type DxReport = {
  fixRate: number;
  avgTimeToGreenMs: number;
  maxTimeToGreenMs: number;
  samples: Array<{ name: string; fixRate: number; timeToGreenMs: number }>;
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
  it("fix-rate === 1 — the published claim (every documented fix path goes green) reproduces", () => {
    expect(
      report.fixRate,
      `[docs claim] fix-rate ${report.fixRate} ≠ 1 — a documented fix path no longer goes green (engine or error-face regression); the "100%" published in vs-typescript.md is not reproducible. This is NOT machine noise — fix-rate has no timing dependency.`,
    ).toBe(1);
  });

  it("avg time-to-green sane (< 10 s); the 2 s ops target is machine-dependent and reported, not gated", () => {
    // 硬钉 sanity 上界：修复环完整走完且无失控（10s ≈ 本机 4 倍余量）。
    expect(
      report.avgTimeToGreenMs,
      `repair loop looks broken: avg time-to-green ${report.avgTimeToGreenMs}ms ≥ 10000ms (fix-rate arm above says whether the paths still go green)`,
    ).toBeLessThan(10_000);
    // 超 2s 目标 → 可区分提示（机器慢，非文档漂移），不判失败。理由见文件头注释：
    // tsx 冷启动主导 + benchmark gate 机器因子先例 + dx-metrics.mjs 自身 exit 分级。
    if (report.avgTimeToGreenMs >= 2000) {
      console.warn(
        `[perf target] avg time-to-green ${report.avgTimeToGreenMs}ms ≥ 2000ms — machine-dependent timing (tsx CLI spawn ×2 per scenario), NOT a docs-drift failure; the published block's seconds are not pinned by any assertion. Re-run on an idle machine before treating it as an engine regression.`,
      );
    }
  });

  it("en+zh generated blocks exist, have structure, and their fix-rate matches the live run", () => {
    const livePct = `${(report.fixRate * 100).toFixed(0)}%`;
    for (const [locale, path] of [
      ["en", EN_DOC],
      ["zh", ZH_DOC],
    ] as const) {
      const md = readFileSync(path, "utf-8");
      const begin = md.indexOf("<!-- dx-metrics:begin -->");
      const end = md.indexOf("<!-- dx-metrics:end -->");
      expect(begin, `${locale}: <!-- dx-metrics:begin --> marker missing in ${path}`).toBeGreaterThanOrEqual(0);
      expect(end, `${locale}: <!-- dx-metrics:end --> marker missing (or before begin) in ${path}`).toBeGreaterThan(
        begin,
      );
      const block = md.slice(begin, end + "<!-- dx-metrics:end -->".length);
      // 结构：生成日期行 + 指标表头 + 目标行（fix-rate 100% / < 2 s）。
      // 秒数刻意不做任何比对——机器相关量，见文件头注释。
      expect(block, `${locale}: no generated-date line in the block`).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block, `${locale}: no fix-rate / time-to-green table header`).toMatch(/fix-rate/);
      expect(block, `${locale}: no time-to-green column`).toMatch(/time-to-green/);
      expect(block, `${locale}: no "< 2 s" target line`).toContain("< 2 s");
      // fix-rate 数值与实跑一致——发布块唯一跨机器可钉的主张。
      expect(
        block,
        `${locale}: published fix-rate does not match the live run (${livePct}) — regenerate with \`pnpm run dx-metrics -- --md\` (en) / \`--md --lang zh\` (zh) and re-paste the block`,
      ).toContain(livePct);
    }
  });
});
