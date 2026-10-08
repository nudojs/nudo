/**
 * 类 C 抽象求值欠近似回归（Bug 47 / 48）——循环携带累加器 widen：
 * - Bug 47：for-of（抽象容器）单代表迭代的出口 join 是 {0 次, 1 次} 两
 *   个打包态（`0 | 1`，conf exact）——常步长累加器（n++ / n += 2）跨迭代
 *   增长，原生 xs.length 任意（[1,2,3] → 3 ∉ {0,1}），引擎自己的具体求值
 *   直接证伪抽象签名；break/continue 打断代表体时 0 次出口独占（假精确
 *   0，反转分支走向）。
 * - Bug 48：while / for / do-while（抽象条件）预算耗尽（maxLoopIters=8）
 *   的出口 join 是 {0..8} / {1..9}（conf exact）——原生 n=100 → 100 ∉
 *   {0..8}。
 * 机制（loop-widen.ts，两形态收敛同一迭代 join/widen helper）：出口快照
 * observe 进累计 join + 逐槽「值级」增长检测（leqAbs 是 shape 级——
 * `{n:1} ⊑ {n:0}` 成立，检测不到计数器）；预算耗尽 / 抽象 fork 臂的
 * break/continue 打断（NudoLoopSignal.abstract 溯源）时对增长槽位宽化到
 * 无上界 prim 域（sound 超集）；join-幂等绑定与全具体循环不动（行为
 * 不变——differential 语料的具体 break/continue 循环仍精确匹配）。
 * 原生 ground truth：node v26 实测（count([1,2,3])=3、whileLoop(100)=100）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  abs,
} from "@nudojs/core";

const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
const arrNum = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);
const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function callWith(
  src: string,
  args: unknown[],
  fnName = "f",
): { value: string; throws: string; lit: { ok: boolean; value?: unknown } } {
  const run = runTranspiled(src, { mode: "analyze" });
  let result: { result?: unknown; throws?: unknown } = {};
  try {
    result = callTranspiledExportFull(run, fnName, args as never[]) as never;
  } catch {
    /* 入口整抛：值域经 throws 面表达 */
  }
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  const l = litValue((result as { result?: unknown }).result);
  return { value: norm(result.result), throws: norm(result.throws), lit: l };
}

describe("Bug 47: for-of（抽象容器）循环携带累加器宽化", () => {
  it("count / countDouble：增长计数器 → 无上界 number（不再 0 | 1 #exact）", () => {
    const r = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { n++; } return n; }`,
      [arrNum],
    );
    expect(r.value).toBe("number");
    expect(r.lit.ok).toBe(false);
    const r2 = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { n += 2; } return n; }`,
      [arrNum],
    );
    expect(r2.value).toBe("number");
  });

  it("嵌套 for-of：内外层叠加 → number（不再 0 | 1）", () => {
    const r = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { for (const w of xs) { n++; } } return n; }`,
      [arrNum],
    );
    expect(r.value).toBe("number");
  });

  it("抽象条件 break / continue 打断代表体 → 宽化（不再假精确 0）", () => {
    // 原生 [-1,-1]：全程不 break → n=2；{0} 反转分支走向
    const br = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { if (v > 0) break; n++; } return n; }`,
      [arrNum],
    );
    expect(br.value).toBe("number");
    const co = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { if (v > 0) continue; n++; } return n; }`,
      [arrNum],
    );
    expect(co.value).toBe("number");
  });

  it("抽象操作数累加（n += v）与具体迭代空间行为不变", () => {
    // n += v（v 抽象 number）本来就被吸收成 number —— 不回归
    const sum = callWith(
      `export function f(xs) { let n = 0; for (const v of xs) { n += v; } return n; }`,
      [arrNum],
    );
    expect(sum.value).toBe("number");
    // 具体 tuple：精确计数（p0 口径）
    const lit = callWith(
      `export function f() { let n = 0; for (const v of [1, 2, 3]) { n++; } return n; }`,
      [],
    );
    expect(lit.lit).toEqual({ ok: true, value: 3 });
  });

  it("join-幂等绑定不宽化：常量赋值保持精确", () => {
    // 体对 m 的效应恒等（m = 5）→ 不增长 → 精确 5；n 增长 → number
    const r = callWith(
      `export function f(xs) { let n = 0; let m = 5; for (const v of xs) { n++; m = 5; } return m; }`,
      [arrNum],
    );
    expect(r.lit).toEqual({ ok: true, value: 5 });
  });

  it("definite break 是忠实语义：全具体循环不宽化", () => {
    // differential 语料面：i===2 全具体 → break 忠实 → 精确值（native
    // s = 0 + 1 = 1，node 实测）；e.abstract=false 不触发打断宽化
    const r = callWith(
      `export function f() { let s = 0; for (let i = 0; i < 5; i++) { if (i === 2) break; s += i; } return s; }`,
      [],
    );
    expect(r.lit).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 48: while / for / do-while（抽象条件）累加器宽化", () => {
  it("while：增长计数器 → number（不再 0..8 #exact）", () => {
    const r = callWith(
      `export function f(n) { let i = 0; while (i < n) { i++; } return i; }`,
      [numAbs],
    );
    expect(r.value).toBe("number");
    expect(r.lit.ok).toBe(false);
  });

  it("for：外层累加器与循环变量都宽化", () => {
    const r = callWith(
      `export function f(n) { let i = 0; for (let j = 0; j < n; j++) { i++; } return i; }`,
      [numAbs],
    );
    expect(r.value).toBe("number");
    // 循环变量本体（经 pack 线程）同宽化：native j = n 任意
    const rj = callWith(
      `export function f(n) { let j = 0; for (; j < n; j++) {} return j; }`,
      [numAbs],
    );
    expect(rj.value).toBe("number");
  });

  it("do-while：body-first 语义 + 宽化（不再 1..9）", () => {
    const r = callWith(
      `export function f(n) { let i = 0; do { i++; } while (i < n); return i; }`,
      [numAbs],
    );
    expect(r.value).toBe("number");
  });

  it("具体界循环保持精确（whileLit → 5）", () => {
    const r = callWith(
      `export function f() { let i = 0; while (i < 5) { i++; } return i; }`,
      [],
    );
    expect(r.lit).toEqual({ ok: true, value: 5 });
  });

  it("抽象操作数累加（acc += i + 1）保持 number（不回归）", () => {
    const r = callWith(
      `export function f(n) { let acc = 0; let i = 0; while (i < n) { acc += i + 1; i++; } return acc; }`,
      [numAbs],
    );
    expect(r.value).toBe("number");
  });

  it("字符串累加器增长 → string 域（不是 number）", () => {
    const r = callWith(
      `export function f(n) { let s = ""; let i = 0; while (i < n) { s = s + "a"; i++; } return s; }`,
      [numAbs],
    );
    expect(r.value).toBe("string");
  });

  it("for-of over any（for-in 键序列同机制）：计数器无上界", () => {
    const r = callWith(
      `export function f(x) { let s = 0; for (const k in x) { s += 1; } return s; }`,
      [anyAbs],
    );
    expect(r.value).toBe("number");
    expect(r.value).not.toBe("0");
  });
});
