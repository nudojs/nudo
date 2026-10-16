// benchmark gate 机器因子探测（benchmark/src/noise.js + 两个 gate 的
// --allow-uniform-shift）：
// 1) detectUniformShift 纯函数单测——均匀 +10% 命中 / 非均匀、幅度 <5%、
//    方向不一致、指标数 <3 不命中；
// 2) 子进程实跑两个 gate（惯例同 gate-major.test.ts 的 GATE_MAJOR_ROOT
//    锚点覆写 + execFileSync）——oss 均匀 +11% 假红默认 exit 1 且带醒目
//    提示、旗标放行；非均匀或混入 FP 回退时旗标无效；src gate 基线只有
//    avgMs 单计时指标，不构成「均匀」证据，旗标下 3.5x 仍红（其 3.0x
//    阈值本身远大于 10~13% 机器因子，见 gate.js 头注）。
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const NOISE = join(repoRoot, "benchmark", "src", "noise.js");
const SRC_GATE = join(repoRoot, "benchmark", "src", "gate.js");
const OSS_GATE = join(repoRoot, "benchmark", "oss", "gate.mjs");

type Metric = { name: string; baseline: number | null; current?: number };
type Shift = { uniform: boolean; medianRatio?: number };

const { detectUniformShift, formatUniformShiftHint } = (await import(NOISE)) as unknown as {
  detectUniformShift: (metrics: Metric[]) => Shift;
  formatUniformShiftHint: (medianRatio: number) => string;
};

/** x1.1 的五指标族——机器因子假红的典型形态（实测 +10~13%）。 */
const uniformTenPct: Metric[] = [
  { name: "cold", baseline: 100, current: 110 },
  { name: "check", baseline: 200, current: 220 },
  { name: "hub", baseline: 300, current: 330 },
  { name: "cold2", baseline: 400, current: 440 },
  { name: "check2", baseline: 500, current: 550 },
];

describe("detectUniformShift — 纯函数", () => {
  it("全部指标同向 +10% 窄带 → uniform 命中，medianRatio=1.1", () => {
    const shift = detectUniformShift(uniformTenPct);
    expect(shift.uniform).toBe(true);
    expect(shift.medianRatio).toBeCloseTo(1.1, 10);
  });

  it("单项撕裂窄带（x1.5 混在 x1.1 中）→ 不命中（定向回归特征）", () => {
    const torn = uniformTenPct.map((m) =>
      m.name === "cold2" ? { ...m, current: 600 } : m,
    );
    expect(detectUniformShift(torn).uniform).toBe(false);
  });

  it("幅度 <5%（全 x1.03）→ 不命中（运行抖动不值得提示）", () => {
    const tiny = uniformTenPct.map((m) => ({ ...m, current: m.baseline! * 1.03 }));
    expect(detectUniformShift(tiny).uniform).toBe(false);
  });

  it("方向不一致（一项 x0.95 混在 x1.1 中）→ 不命中", () => {
    const mixed = uniformTenPct.map((m) =>
      m.name === "hub" ? { ...m, current: 285 } : m,
    );
    expect(detectUniformShift(mixed).uniform).toBe(false);
  });

  it("指标数 <3（1–2 个计时点）→ 不命中：单指标区分不了机器因子与定向回退", () => {
    expect(detectUniformShift(uniformTenPct.slice(0, 2)).uniform).toBe(false);
    expect(
      detectUniformShift([{ name: "avgMs", baseline: 1000, current: 3500 }]).uniform,
    ).toBe(false);
  });

  it("未设阈值的条目（baseline null）被忽略；提示文本带旗标名", () => {
    const withNull: Metric[] = [
      { name: "cold", baseline: 100, current: 110 },
      { name: "no-limit", baseline: null, current: 12345 },
      ...uniformTenPct.slice(1),
    ];
    expect(detectUniformShift(withNull).uniform).toBe(true);
    expect(formatUniformShiftHint(1.1)).toContain("+10.0%");
    expect(formatUniformShiftHint(1.1)).toContain("--allow-uniform-shift");
  });
});

// ---------------------------------------------------------------------------
// 子进程实跑 gate（fixture 锚点覆写：oss 用 OSS_GATE_ROOT，src 用 cwd）
// ---------------------------------------------------------------------------

const temps: string[] = [];

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function runGate(
  script: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // GITHUB_ACTIONS 会把 TIME_SLACK 放宽到 3x，吞掉 +11% 假红场景；
  // 本套件验证的是本地（slack=1.0）机器因子路径。
  delete env.GITHUB_ACTIONS;
  Object.assign(env, opts.env ?? {});
  // spawnSync（而非 execFileSync）：放行路径的提示在 stderr，成功时也要能断言
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd ?? repoRoot,
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}

function writeSrcFixture(avgMs: number): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-src-gate-"));
  temps.push(root);
  const counts = { exactMatches: 1, partialMatches: 0, unknownCount: 0, errorCount: 0 };
  mkdirSync(join(root, "benchmark", "results"), { recursive: true });
  writeFileSync(
    join(root, "benchmark", "baseline.json"),
    JSON.stringify({
      totalCases: 1,
      results: counts,
      averageTimeMs: 1000,
      cases: [{ id: "basic-01", name: "x", comparison: "exact" }],
    }),
  );
  writeFileSync(
    join(root, "benchmark", "results", "latest.json"),
    JSON.stringify({
      summary: { totalCases: 1, results: counts, performance: { averageTimeMs: String(avgMs) } },
      results: [{ id: "basic-01", name: "x", comparison: "exact" }],
    }),
  );
  return root;
}

/** 三包 OSS 基线（形态对齐 benchmark/oss/baseline.json 真值）。 */
const OSS_BASE = {
  totals: { maxFpCount: 0, maxColdAnalyzeMs: 6000, maxCheckAllMs: 1800 },
  packages: [
    { name: "commander", minFiles: 5, maxFpCount: 0, maxColdAnalyzeMs: 1000, maxCheckAllMs: 300, maxHubDirtyMedianMs: 800 },
    { name: "yargs", minFiles: 18, maxFpCount: 0, maxColdAnalyzeMs: 2000, maxCheckAllMs: 600, maxHubDirtyMedianMs: 1500 },
    { name: "semver", minFiles: 39, maxFpCount: 0, maxColdAnalyzeMs: 900, maxCheckAllMs: 250, maxHubDirtyMedianMs: 700 },
  ],
};

/**
 * 写一对 report/baseline fixture。计时指标 = totals×2 + 各包×3 = 11 个；
 * cmdColdMul 单独可调，用于构造「单项撕裂窄带」的非均匀对照。
 */
function writeOssFixture(opts: {
  coldMul: number;
  checkMul: number;
  hubMul: number;
  fp?: number;
  cmdColdMul?: number;
}): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-oss-gate-"));
  temps.push(root);
  const mul = (v: number, m: number) => Math.round(v * m);
  const fp = opts.fp ?? 0;
  const report = {
    totals: {
      files: 62,
      fpCount: fp,
      coldAnalyzeMs: mul(6000, opts.coldMul),
      checkAllMs: mul(1800, opts.checkMul),
    },
    packages: OSS_BASE.packages.map((p, i) => ({
      name: p.name,
      files: p.minFiles + 1,
      fpCount: i === 0 ? fp : 0,
      coldAnalyzeMs: mul(p.maxColdAnalyzeMs!, i === 0 ? opts.cmdColdMul ?? opts.coldMul : opts.coldMul),
      checkAllMs: mul(p.maxCheckAllMs!, opts.checkMul),
      hub: { dirtyMedianMs: mul(p.maxHubDirtyMedianMs!, opts.hubMul) },
    })),
  };
  mkdirSync(join(root, "docs", "reports"), { recursive: true });
  mkdirSync(join(root, "benchmark", "oss"), { recursive: true });
  writeFileSync(join(root, "docs", "reports", "oss-perf-baseline.json"), JSON.stringify(report));
  writeFileSync(join(root, "benchmark", "oss", "baseline.json"), JSON.stringify(OSS_BASE));
  return root;
}

describe("oss gate — 机器因子探测 + --allow-uniform-shift", () => {
  it("全指标均匀 +11%：默认 exit 1 且带醒目提示（CI 硬门不变）", () => {
    const root = writeOssFixture({ coldMul: 1.11, checkMul: 1.11, hubMul: 1.11 });
    const r = runGate(OSS_GATE, [], { env: { OSS_GATE_ROOT: root } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("疑似机器/环境因子（全指标均匀漂移 +11.0%）");
    expect(r.stderr).toContain("--allow-uniform-shift");
  });

  it("全指标均匀 +11% + 旗标：exit 0 放行", () => {
    const root = writeOssFixture({ coldMul: 1.11, checkMul: 1.11, hubMul: 1.11 });
    const r = runGate(OSS_GATE, ["--allow-uniform-shift"], { env: { OSS_GATE_ROOT: root } });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("均匀漂移，放行");
  });

  it("单项撕裂窄带（commander cold x1.5）：旗标不放行、无机器因子提示", () => {
    const root = writeOssFixture({ coldMul: 1.11, checkMul: 1.11, hubMul: 1.11, cmdColdMul: 1.5 });
    const r = runGate(OSS_GATE, ["--allow-uniform-shift"], { env: { OSS_GATE_ROOT: root } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("commander: cold analyze 1500ms > 1000ms");
    expect(r.stderr).not.toContain("疑似机器/环境因子");
  });

  it("均匀漂移但混入 FP 回退：旗标不放行（FP/正确性门不受旗标影响）", () => {
    const root = writeOssFixture({ coldMul: 1.11, checkMul: 1.11, hubMul: 1.11, fp: 1 });
    const r = runGate(OSS_GATE, ["--allow-uniform-shift"], { env: { OSS_GATE_ROOT: root } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("L1 FP 1 > 0");
    expect(r.stderr).toContain("疑似机器/环境因子");
    expect(r.stderr).not.toContain("放行。");
  });

  it("无漂移无回退：exit 0", () => {
    const root = writeOssFixture({ coldMul: 0.9, checkMul: 0.9, hubMul: 0.9 });
    const r = runGate(OSS_GATE, [], { env: { OSS_GATE_ROOT: root } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("OSS baseline gate OK");
  });
});

describe("src gate — 单计时指标不构成均匀证据，旗标下 3.5x 仍红", () => {
  it("avg 3.5x：默认 exit 1", () => {
    const r = runGate(SRC_GATE, [], { cwd: writeSrcFixture(3500) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("性能回退");
    expect(r.stderr).not.toContain("疑似机器/环境因子");
  });

  it("avg 3.5x + 旗标：仍 exit 1（baseline 只存 avgMs，< MIN_METRICS）", () => {
    const r = runGate(SRC_GATE, ["--allow-uniform-shift"], { cwd: writeSrcFixture(3500) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("性能回退");
  });

  it("无回退：exit 0（旗标解析不影响通过路径）", () => {
    const r = runGate(SRC_GATE, ["--allow-uniform-shift"], { cwd: writeSrcFixture(900) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Benchmark gate passed");
  });
});
