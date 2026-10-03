/**
 * 具体循环两段预算（maxIters 抽象预算 + MAX_CONCRETE_LOOP_ITERS 硬上限）：
 * - 具体迭代空间（definitely-true 条件 / 精确长度 iterable）截断在 maxIters
 *   会产出**错误的 #exact**（症状 A：globToRegex 对 12 字符 glob 只跑 8 轮，
 *   拼出 `^lib\/debu$` 还声明 exact → negation case 求值成 true，原生 false）；
 * - 硬上限仍未终止（无限具体循环）→ noteAbsTruncation(#loop-iterations) +
 *   绑定 conf 降级 partial（有界、可观测，与 fork/call 预算同 posture）；
 * - 抽象条件循环语义不变（仍以 maxIters 为预算，出口 join）。
 * 同时钉住 for-of `continue` 前的绑定写保留（副作用经闭包直达绑定，
 * pack/unpack 不吞写）。
 *
 * 症状 B：callTranspiledExportFull 收宿主裸值实参（raw string/array）——
 * 必须经 asAbsVal 收成 exact lit/tuple；裸值流进代数算子（$not 读 a.shape.k）
 * 会崩成 `Cannot read properties of undefined (reading 'k')` → internal 回落 +
 * throws TypeError（假面）。raw 字面量照常精确求值。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  setEvalFallbackCollector,
  $lit,
  $arr,
  litValue,
  type EvalFallback,
} from "@nudojs/core";
import { setAbsTruncationCollector } from "@nudojs/core/internal";

function callFull(
  src: string,
  fnName: string,
  args: unknown[],
  mode: "exec" | "analyze" = "analyze",
) {
  const exports = runTranspiled(src, { mode });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

function withFallbacks(fn: () => unknown): { fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    fn();
    return { fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

const PACKLIST = `
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; } else { out += '[^/]*'; }
    } else if (ch === '?') { out += '[^/]'; }
    else { out += ch.replace(/[.+^\${}()|[\\]\\\\]/g, '\\\\$&'); }
  }
  return new RegExp(\`^\${out}$\`);
}
export function selectedByFiles(path, files) {
  if (!files || files.length === 0) return true;
  let selected = false;
  for (const pattern of files) {
    if (pattern.startsWith('!')) {
      if (globToRegex(pattern.slice(1)).test(path)) selected = false;
      continue;
    }
    const re = globToRegex(pattern);
    if (re.test(path) || (path.startsWith(pattern + '/') && !pattern.includes('*'))) selected = true;
  }
  return selected;
}
`;

describe("concrete loop iteration (two-tier budget)", () => {
  it("symptom A: >8-iteration inner loop + for-of continue negation evaluates natively (false)", () => {
    // glob "lib/debug.js" 是 12 字符 → 内层 for 需要 12 轮才能拼出正确的
    // `^lib\/debug\.js$`；截断在 8 轮时 negation 分支 test() 恒 false，
    // `selected = false` 永不执行 → 错误返回 true #exact。
    const { fallbacks } = withFallbacks(() => {
      const full = callFull(PACKLIST, "selectedByFiles", [
        $lit("lib/debug.js"),
        $arr([$lit("lib"), $lit("!lib/debug.js")]),
      ]);
      expect(litValue(full.result)).toEqual({ ok: true, value: false });
      expect(full.result.conf).toBe("exact");
      expect(full.throws.shape.k).toBe("never");
    });
    expect(fallbacks.map((f) => f.reason)).not.toContain("internal");
  });

  it("for-of over a concrete string iterates every code point past the budget", () => {
    const src = `
export function countChars(s) {
  let n = 0;
  for (const ch of s) { n = n + 1; }
  return n;
}`;
    const full = callFull(src, "countChars", [$lit("abcdefghijkl")]);
    expect(litValue(full.result)).toEqual({ ok: true, value: 12 });
  });

  it("counter loops (for / while / do-while) past the budget stay exact", () => {
    const src = `
export function forSum(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) acc += i + 1;
  return acc;
}
export function whileSum(n) {
  let i = 0; let acc = 0;
  while (i < n) { i = i + 1; acc = acc + i; }
  return acc;
}
export function doSum(n) {
  let i = 0; let acc = 0;
  do { i = i + 1; acc = acc + i; } while (i < n);
  return acc;
}`;
    // 1+…+12 = 78（旧预算 8 轮 = 36/45 假精确）
    for (const fn of ["forSum", "whileSum", "doSum"]) {
      const full = callFull(src, fn, [$lit(12)]);
      expect(litValue(full.result), fn).toEqual({ ok: true, value: 78 });
    }
    // 预算内的短循环不受影响
    expect(litValue(callFull(src, "forSum", [$lit(3)]).result)).toEqual({
      ok: true,
      value: 6,
    });
  });

  it("for-of continue keeps writes to outer bindings (minimal shape)", () => {
    const src = `
export function f(files) {
  let selected = false;
  for (const pattern of files) {
    if (pattern.startsWith('!')) {
      if (pattern.length > 2) selected = false;
      continue;
    }
    selected = true;
  }
  return selected;
}`;
    const full = callFull(src, "f", [$arr([$lit("lib"), $lit("!xy")])]);
    expect(litValue(full.result)).toEqual({ ok: true, value: false });
  });

  it("continue taken on the budget-boundary iteration still extends the loop", () => {
    // continue 吸收路径不得跳过边界门：第 8 轮（预算边界）走 continue 时
    // 条件仍具体真 → 照常延展，i 数满 12（旧实现停在 8 假精确 36）。
    const src = `
export function sumWithSkip(n, skip) {
  let i = 0;
  let acc = 0;
  while (i < n) {
    i = i + 1;
    if (i === skip) continue;
    acc = acc + i;
  }
  return acc;
}`;
    const full = callFull(src, "sumWithSkip", [$lit(12), $lit(8)]);
    // 1+…+12 − 8 = 70
    expect(litValue(full.result)).toEqual({ ok: true, value: 70 });
  });

  it("infinite concrete loop: bounded, observed as #loop-iterations, not exact", () => {
    const src = `
export function infiniteDec(n) {
  let i = 0;
  while (i < n) { i = i - 1; }
  return i;
}`;
    const labels: string[] = [];
    setAbsTruncationCollector((label) => labels.push(label));
    try {
      const full = callFull(src, "infiniteDec", [$lit(5)]);
      // 有界截断：值停在硬上限处，但 conf 必须降级（不得声明 exact）
      expect(full.result.conf).toBe("partial");
      expect(labels).toContain("#loop-iterations");
    } finally {
      setAbsTruncationCollector(null);
    }
  });

  it("explicit maxLoopIters above the hard cap stays the caller's budget", () => {
    const src = `
export function countUp(n) {
  let i = 0;
  while (i < n) { i = i + 1; }
  return i;
}`;
    const exports = runTranspiled(src, { mode: "analyze", maxLoopIters: 2000 });
    const full = callTranspiledExportFull(exports, "countUp", [$lit(1500)]);
    expect(litValue(full.result)).toEqual({ ok: true, value: 1500 });
  });

  it("abstract-condition loops keep the maxIters budget (no extension)", () => {
    const src = `
export function sumTo(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) acc += i + 1;
  return acc;
}`;
    // 抽象 n：条件不具体真，延展不触发——结果并出口（非精确字面量）
    const exports = runTranspiled(src, { mode: "analyze" });
    const full = callTranspiledExportFull(exports, "sumTo", [
      { shape: { k: "unknown" }, conf: "partial" } as never,
    ]);
    expect(litValue(full.result).ok).toBe(false);
  });
});

describe("callTranspiledExportFull host bare-value args (symptom B)", () => {
  it("raw string/array args are collected as exact Abs — no crash, no internal fallback", () => {
    const { fallbacks } = withFallbacks(() => {
      const full = callFull(PACKLIST, "selectedByFiles", [
        "lib/debug.js",
        ["lib", "!lib/debug.js"],
      ]);
      expect(litValue(full.result)).toEqual({ ok: true, value: false });
      expect(full.throws.shape.k).toBe("never");
    });
    // 症状 B：裸数组流进 $not 读 a.shape.k → internal `reading 'k'` + throws TypeError
    expect(fallbacks).toEqual([]);
  });

  it("mixed raw + Abs args evaluate precisely", () => {
    const full = callFull(PACKLIST, "selectedByFiles", [
      $lit("lib/debug.js"),
      ["lib", "!lib/debug.js"],
    ]);
    expect(litValue(full.result)).toEqual({ ok: true, value: false });
  });

  it("raw numeric/boolean/nullish args fold to exact literals", () => {
    const src = `
export function tri(a, b, c) {
  if (a === 1) return b + c;
  return a;
}`;
    const full = callFull(src, "tri", [1, 20, 22]);
    expect(litValue(full.result)).toEqual({ ok: true, value: 42 });
  });
});
