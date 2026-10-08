/**
 * 调用边界契约面（issue #123 fix B）端到端回归。
 *
 * callee 声明 param/return 契约（`*.nudo.js` 侧车 fn() 绑定）时，调用边界
 * 采用契约面：参数位仅替换**无信息**实参（any / 非 lit unknown），返回位
 * 呈现声明面（#102 DP-OOB 标记臂 / widen 臂不外溢给调用方）。契约从
 * 「只执法」升级为「调用方可见的类型面」；callee 自身的 unproven-return
 * 诚实警告照旧在 callee 侧报。
 *
 * 覆盖面（跨模块走 checkSource opts.modules 桥接 Abs——CLI 的
 * evalAbsModuleGraph 注入面同构；同文件走 ambient 侧车同名绑定）：
 *   (a) issue 四变体（立即比较 / const 绑定 / 字面量右元 / 变量右元）跨模块清零；
 *   (b) 同文件四变体清零（callee 自身 unproven-return 警告保留）；
 *   (c) probe 形态（纯转发 / 存 const）清零，调用方签名呈契约返回面 number；
 *   (d) callee 自身 check 不变：unproven-return 警告在场 + 推断签名（含
 *       #102 标记臂 undefined）保留；
 *   (e) 精度控制：字面量实参结果保留字面量精度（不退化为 prim 面）；
 *   (f) 返回约束精度：number().ge(0) 返回面让调用方 `d + 1 ≥ 1` /
 *       `100 - d ≤ 100`（issue 的 `1 - d/max ≤ 1` 同形上界链）可证；
 *       对照组（裸 number() 返回契约）调用方 unproven-return；
 *   (g) 对照组：无契约 callee + 无约束实参仍诚实记录 may-throw（无面可采，
 *       行为不变——zero-FP 纪律）。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  runTranspiled,
  callTranspiledExportApply,
  absFunction,
} from "@nudojs/core";

// ---------------------------------------------------------------------------
// fixtures（issue #123 原文：levenshtein DP + fn({a,b: string}, number)）
// ---------------------------------------------------------------------------

const DISTANCE = `
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost);
    }
  }
  return d[m][n];
}
`;

const DISTANCE_SIDE = `
import { string, number, fn } from "@nudojs/core";
export const levenshtein = fn({ a: string(), b: string() }, number());
`;

const FOUR_VARIANTS = `
export function vImm(a, b)   { return levenshtein(a, b) <= 1; }
export function vConst(a, b){ const d = levenshtein(a, b); return d <= 1; }
export function vLtLit(a, b){ const d = levenshtein(a, b); return d < 2; }
export function vLtVar(a, b){ const d = levenshtein(a, b); const lim = 2; return d < lim; }
`;

/** (e)/(f)/(g) 的依赖库：gain（带 ge(0) 返回契约）/ gainPlain（对照）/
 *  echo（恒等）/ rawRel（无契约——may-throw 对照） */
const LIB = `
export function gain(x) { return x; }
export function gainPlain(x) { return x; }
export function echo(x) { return x; }
export function rawRel(x) { return x <= 1; }
`;

const LIB_SIDE = `
import { string, number, fn } from "@nudojs/core";
export const gain = fn({ x: number().ge(0) }, number().ge(0));
export const gainPlain = fn({ x: number() }, number());
export const echo = fn({ x: string() }, string());
`;

// ---------------------------------------------------------------------------
// harness：跨模块 = 桥接 Abs fn（service evalExportsToModuleExports 同构）；
// 侧车按 ambient 约定命名（<dep>.nudo.js ↔ <dep>.js，sidecarPathOf 口径）
// ---------------------------------------------------------------------------

type CheckResult = ReturnType<typeof checkSource>;

/** 依赖模块求值一次，按导出名桥接成 fn Abs（apply → callTranspiledExportFull） */
function bridgeDep(depSrc: string, names: string[]): Record<string, unknown> {
  const run = runTranspiled(depSrc, { mode: "analyze" });
  const named: Record<string, unknown> = {};
  for (const n of names) {
    named[n] = absFunction(["x"], {
      apply: callTranspiledExportApply(run, n),
      kind: "eval-export",
      fingerprint: `eval:test123#${n}`,
    });
  }
  return named;
}

/** 跨模块 caller 的 checkSource opts（loadModule 服务依赖源码 + 侧车） */
function xmOpts(
  filePath: string,
  specs: Record<string, string | undefined>,
  modules: Record<string, Record<string, unknown>>,
) {
  return {
    loadModule: (spec: string) => specs[spec],
    fromFile: filePath,
    modules,
  };
}

function l2Count(r: CheckResult, fn?: string): number {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  ).length;
}

function sigOf(r: CheckResult, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

function codes(r: CheckResult): string[] {
  return r.issues.map((i) => i.code);
}

// ---------------------------------------------------------------------------
// (a) issue 四变体：跨模块
// ---------------------------------------------------------------------------

describe("#123 (a) 跨模块四变体：契约面采用后清零", () => {
  const specs: Record<string, string | undefined> = {
    "./distance.js": DISTANCE,
    "./distance.nudo.js": DISTANCE_SIDE,
  };
  const modules = {
    "./distance.js": {
      named: bridgeDep(DISTANCE, ["levenshtein"]),
      evaluated: true,
    },
  };

  function check(src: string): CheckResult {
    return checkSource("/t/xm123.js", src, pTrue, xmOpts("/t/xm123.js", specs, modules));
  }

  it("四变体 0 错误 / 0 L2 / 签名 boolean 无 throws", () => {
    const r = check(`import { levenshtein } from './distance.js';\n${FOUR_VARIANTS}`);
    expect(r.ok).toBe(true);
    expect(r.summary.errors).toBe(0);
    expect(r.summary.warnings).toBe(0);
    expect(l2Count(r)).toBe(0);
    for (const fn of ["vImm", "vConst", "vLtLit", "vLtVar"]) {
      expect(sigOf(r, fn)).toMatch(/boolean/);
      expect(sigOf(r, fn)).not.toMatch(/throws/);
    }
  });

  it("probe 形态（纯转发 / 存 const）清零，签名呈契约返回面 number", () => {
    const r = check(`import { levenshtein } from './distance.js';
export function probe(a, b) { return levenshtein(a, b); }
export function probeStored(a, b) { const d = levenshtein(a, b); return d; }`);
    expect(r.ok).toBe(true);
    expect(l2Count(r)).toBe(0);
    expect(codes(r)).toEqual([]);
    // 返回面替换推断面：#102 标记臂（undefined）不外溢给调用方
    expect(sigOf(r, "probe")).toMatch(/number/);
    expect(sigOf(r, "probe")).not.toMatch(/undefined/);
    expect(sigOf(r, "probeStored")).toMatch(/number/);
    expect(sigOf(r, "probeStored")).not.toMatch(/undefined/);
  });
});

// ---------------------------------------------------------------------------
// (b) 同文件四变体（ambient 侧车同名绑定）
// ---------------------------------------------------------------------------

describe("#123 (b) 同文件四变体：契约面采用后清零", () => {
  const opts = {
    loadModule: (spec: string) =>
      spec === "./same123.nudo.js" ? DISTANCE_SIDE : undefined,
    fromFile: "/t/same123.js",
  };
  const check = (src: string) => checkSource("/t/same123.js", src, pTrue, opts);

  it("四变体 0 错误 / 0 L2 / 签名 boolean；callee 自身 unproven-return 保留", () => {
    const r = check(DISTANCE + FOUR_VARIANTS);
    expect(r.summary.errors).toBe(0);
    expect(l2Count(r)).toBe(0);
    for (const fn of ["vImm", "vConst", "vLtLit", "vLtVar"]) {
      expect(sigOf(r, fn)).toMatch(/boolean/);
      expect(sigOf(r, fn)).not.toMatch(/throws/);
    }
    // callee 诚实性不受调用边界面影响（d 项的同文件形态）
    expect(codes(r)).toContain("nudo:unproven-return");
    expect(sigOf(r, "levenshtein")).toMatch(/undefined/);
  });

  it("probe 形态同文件清零，签名呈契约返回面 number", () => {
    const r = check(`${DISTANCE}export function probeSF(a, b) { return levenshtein(a, b); }`);
    expect(r.summary.errors).toBe(0);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "probeSF")).toMatch(/number/);
    expect(sigOf(r, "probeSF")).not.toMatch(/undefined/);
  });
});

// ---------------------------------------------------------------------------
// (d) callee 自身 check 语义不变
// ---------------------------------------------------------------------------

describe("#123 (d) callee 自身 check 不变（distance.js 单独检查）", () => {
  it("unproven-return 警告在场 + 推断签名（#102 标记臂）保留", () => {
    const opts = {
      loadModule: (spec: string) =>
        spec === "./distance.nudo.js" ? DISTANCE_SIDE : undefined,
      fromFile: "/t/distance.js",
    };
    const r = checkSource("/t/distance.js", DISTANCE, pTrue, opts);
    expect(r.summary.errors).toBe(0);
    expect(codes(r)).toContain("nudo:unproven-return");
    const sig = r.signatures.find((s) => s.name === "levenshtein");
    expect(sig).toBeDefined();
    // 契约参数面上屏（callee 自身路径的既有行为，不因调用边界面改变）
    expect(sig!.paramTypes).toEqual(["string", "string"]);
    // 推断返回签名保留：#102 标记臂（undefined）未被返回面洗白。
    // 真实臂经 Bug 48 循环携带宽化（DP 表 cell 增长 → 无上界 prim 域），
    // 字面量枚举（0 | 1..7）折 number——`0` 臂不再单独保留（与
    // eval-loop-carried-widen 同口径）
    expect(sig!.display).toMatch(/undefined/);
    expect(sig!.display).toMatch(/number/);
  });
});

// ---------------------------------------------------------------------------
// (e) 精度控制 + (f) 返回约束精度 + (g) 无契约对照（跨模块）
// ---------------------------------------------------------------------------

describe("#123 (e)/(f)/(g) 跨模块精度与对照", () => {
  const specs: Record<string, string | undefined> = {
    "./dep.js": LIB,
    "./dep.nudo.js": LIB_SIDE,
  };

  function check(src: string, extraSpecs?: Record<string, string | undefined>): CheckResult {
    const names = ["gain", "gainPlain", "echo", "rawRel"];
    return checkSource(
      "/t/xm2-123.js",
      src,
      pTrue,
      xmOpts("/t/xm2-123.js", { ...specs, ...extraSpecs }, {
        "./dep.js": { named: bridgeDep(LIB, names), evaluated: true },
      }),
    );
  }

  it("(e) 字面量实参结果保留字面量精度（不退化为 prim 面）", () => {
    const r = check(`import { echo } from './dep.js';
export function passLit() { return echo("abc"); }`);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual([]);
    expect(sigOf(r, "passLit")).toContain('"abc"');
    expect(sigOf(r, "passLit")).not.toMatch(/^string$/);
  });

  it("(e2) 无信息实参被参数面替换：callee 体内在 string 域求值（对照 typed 形态）", () => {
    const r = check(`import { echo } from './dep.js';
export function fwd(x) { return echo(x); }`);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual([]);
    // x: any → 采用 string 面 → 结果 string（不再是 any/unknown）
    expect(sigOf(r, "fwd")).toMatch(/string/);
  });

  it("(f) ge(0) 返回面：调用方 `d + 1 ≥ 1` 可证（0 issues）", () => {
    const r = check(`import { gain } from './dep.js';
export function bump(x) { const d = gain(x); return d + 1; }`);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual([]);
    expect(sigOf(r, "bump")).toMatch(/≥ 1/);
  });

  it("(f2) ge(0) 返回面：`100 - d ≤ 100` 上界（issue 的 1 - d/max ≤ 1 同形）可证", () => {
    const r = check(`import { gain } from './dep.js';
export function norm(x) { const d = gain(x); return 100 - d; }`);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual([]);
    expect(sigOf(r, "norm")).toMatch(/≤ 100/);
  });

  it("(f3) 对照：裸 number() 返回契约无谓词——调用方上界不可证（unproven-return）", () => {
    const r = check(`import { gainPlain } from './dep.js';
export function bumpPlain(x) { const d = gainPlain(x); return d + 1; }`);
    // 调用方自身无返回契约 → 不可证只体现在无谓词签名上（不是 error）
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "bumpPlain")).not.toMatch(/≥ 1/);
  });

  it("(f4) 调用方声明返回契约时：有 ge(0) 面可证 / 裸 number 面不可证", () => {
    // 调用方自己的 ambient 侧车：bumpC 声明 ge(1)，bumpPlainC 同声明但被调无谓词
    const callerSide = `
import { number, fn } from "@nudojs/core";
export const bumpC = fn({ x: number() }, number().ge(1));
export const bumpPlainC = fn({ x: number() }, number().ge(1));
`;
    const src = `import { gain, gainPlain } from './dep.js';
export function bumpC(x) { const d = gain(x); return d + 1; }
export function bumpPlainC(x) { const d = gainPlain(x); return d + 1; }`;
    const r = check(src, { "./xm2-123.nudo.js": callerSide });
    const unprovenFns = r.issues
      .filter((i) => i.code === "nudo:unproven-return")
      .map((i) => i.fn);
    expect(unprovenFns).toEqual(["bumpPlainC"]);
    expect(r.summary.errors).toBe(0);
    expect(l2Count(r)).toBe(0);
  });

  it("(g) 对照：无契约 callee + 无约束实参仍诚实记录 may-throw", () => {
    const r = check(`import { rawRel } from './dep.js';
export function g(x) { return rawRel(x); }`);
    expect(r.ok).toBe(false);
    expect(l2Count(r, "g")).toBe(1);
    expect(sigOf(r, "g")).toMatch(/throws/);
  });
});

// ---------------------------------------------------------------------------
// (f-same) 返回约束精度：同文件形态
// ---------------------------------------------------------------------------

describe("#123 (f) 同文件：ge(0) 返回面让调用方上界可证", () => {
  it("callee 契约自洽（param ge(0)）时调用方 0 issues；对照无谓词面时 unproven", () => {
    const side = `
import { number, fn } from "@nudojs/core";
export const gainSF = fn({ x: number().ge(0) }, number().ge(0));
export const gainPlainSF = fn({ x: number() }, number());
export const bumpSF = fn({ x: number() }, number().ge(1));
export const bumpPlainSF = fn({ x: number() }, number().ge(1));
`;
    const src = `
export function gainSF(x) { return x; }
export function gainPlainSF(x) { return x; }
export function bumpSF(x) { const d = gainSF(x); return d + 1; }
export function bumpPlainSF(x) { const d = gainPlainSF(x); return d + 1; }
`;
    const r = checkSource("/t/sf-123.js", src, pTrue, {
      loadModule: (spec) => (spec === "./sf-123.nudo.js" ? side : undefined),
      fromFile: "/t/sf-123.js",
    });
    expect(r.summary.errors).toBe(0);
    expect(l2Count(r)).toBe(0);
    const unprovenFns = r.issues
      .filter((i) => i.code === "nudo:unproven-return")
      .map((i) => i.fn);
    expect(unprovenFns).toEqual(["bumpPlainSF"]);
    expect(sigOf(r, "bumpSF")).toMatch(/≥ 1/);
  });
});
