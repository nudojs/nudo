/**
 * issue #176：Array.from({length}, mapFn) 的 mapFn 第二参（下标 i）此前是
 * 裸 number（无 term 无 pred）——`Array.from({length: a.length + 1}, (_, i) => [i])`
 * 的元素域被无界下标污染，dp[0][0] 连 ge(0) 都证不出。修复：抽象下标 Abs
 * 携带 ge(idx, 0)，长度槽值带项且 prim number 载体时再挂 lt(idx, lenTerm)
 * （ArrayFrom 规格事实 0 ≤ i < ToLength(length)，soundness 注释见
 * builtins/array.ts fromIdxAbs）。lit 长度走 tuple 物化（具体下标），不变。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs, litValue, num, type Abs } from "../abs.ts";
import { ge, type Pred } from "../pred.ts";
import { lit, termEquals, v, type Term } from "../term.ts";
import { call } from "./eval-helpers.ts";

// —— 端到端：侧车契约（check 门） ——————————————————————————

const sidecar = `
export const f = fn({ a: string() }, number().ge(0));
export const g = fn({ n: number().ge(0) }, array(number().ge(0)));
`;
const opts = {
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: "/t/fromidx.js",
};

describe("#176 Array.from mapFn 下标界（端到端）", () => {
  it("dp[0][0]：抽象长度 a.length+1 → ge(0) 证得（此前 unproven-return）", () => {
    const src = `export function f(a) { const dp = Array.from({length: a.length + 1}, (_, i) => [i]); return dp[0][0]; }`;
    const r = checkSource("/t/fromidx.js", src, pTrue, opts);
    expect(
      r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "f"),
    ).toBe(false);
  });

  it("Array.from({length: n}, (_, i) => i)：元素域 ge(0) 证得", () => {
    const src = `export function g(n) { return Array.from({length: n}, (_, i) => i); }`;
    const r = checkSource("/t/fromidx.js", src, pTrue, opts);
    expect(
      r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "g"),
    ).toBe(false);
  });

  it("无 mapFn（对照）：元素域 undefined → 契约不证得（constraint-violated）", () => {
    const src = `export function g(n) { return Array.from({length: n})[0]; }`;
    const r = checkSource("/t/fromidx.js", src, pTrue, opts);
    // nullish 返回撞非空契约走 constraint-violated（先于 unproven-return 的
    // 专项折叠）——要点是无 mapFn 时下标界不凭空出现，契约诚实不证得
    expect(
      r.issues.some(
        (i) =>
          i.severity === "error" &&
          i.fn === "g" &&
          (i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return"),
      ),
    ).toBe(true);
  });
});

// —— 单元：mapFn 收到的下标 Abs ——————————————————————————

function predAtoms(p: Pred | undefined): Pred[] {
  if (!p || p.op === "true") return [];
  if (p.op === "and" || p.op === "or") return p.args.flatMap(predAtoms);
  return [p];
}

/** 下标 Abs 的谓词原子里找 op 且两端项恒等 */
function hasAtom(idx: Abs, op: "ge" | "lt", b: Term): boolean {
  const t = idx.term;
  if (!t) return false;
  return predAtoms(idx.pred).some(
    (p) =>
      (p.op === "ge" || p.op === "lt") &&
      p.op === op &&
      termEquals(p.a, t) &&
      termEquals(p.b, b),
  );
}

describe("#176 单元：下标 Abs 的 term/pred", () => {
  const nAbs = abs(num().shape, v("n"), ge(v("n"), lit(0)), "path");

  it("抽象长度（prim number 带项）：fromIdx# 项 + ge(·,0) ∧ lt(·, n)", () => {
    const r = call(`export function f(n) { return Array.from({length: n}, (_, i) => i); }`, "f", [
      nAbs,
    ]);
    const res = r.result as Abs;
    expect(res.shape.k).toBe("arr");
    const idx = (res.shape as { element: Abs }).element;
    expect(idx.term?.op).toBe("var");
    expect((idx.term as { id?: string }).id).toMatch(/^fromIdx#\d+$/);
    expect(hasAtom(idx, "ge", lit(0))).toBe(true);
    expect(hasAtom(idx, "lt", v("n"))).toBe(true);
  });

  it("arr 接收者：无长度面 → 只挂 ge(0)，不挂 lt", () => {
    const xs = abs(
      { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
      undefined,
      undefined,
      "path",
    );
    const r = call(`export function f(xs) { return Array.from(xs, (_, i) => i); }`, "f", [xs]);
    const idx = ((r.result as Abs).shape as { element: Abs }).element;
    expect((idx.term as { id?: string }).id).toMatch(/^fromIdx#\d+$/);
    expect(hasAtom(idx, "ge", lit(0))).toBe(true);
    expect(predAtoms(idx.pred).some((p) => p.op === "lt")).toBe(false);
  });

  it("超长 lit 长度（> TUPLE_MATERIALIZE_CAP 4096）：双界 ge(0) ∧ lt(·, 8192)", () => {
    const r = call(`export function f() { return Array.from({length: 8192}, (_, i) => i); }`);
    const idx = ((r.result as Abs).shape as { element: Abs }).element;
    expect(hasAtom(idx, "ge", lit(0))).toBe(true);
    expect(hasAtom(idx, "lt", lit(8192))).toBe(true);
  });

  it("超长 lit + 缺失槽：seed 下标不再钉死 0（元素域不假折全 true）", () => {
    // 此前缺失槽臂 seed numLit(0)：i === 0 全折 true（假精确，不 sound）；
    // 现在 seed 是带界抽象下标 → 0 在 [0, 8192) 值域内不可判 → 诚实 bool 域
    const r = call(`export function f() { return Array.from({length: 8192}, (_, i) => i === 0); }`);
    const el = ((r.result as Abs).shape as { element: Abs }).element;
    expect((el.shape as { k?: string; type?: string }).k).toBe("prim");
    expect((el.shape as { type?: string }).type).toBe("boolean");
    expect(el.term?.op).not.toBe("lit");
  });

  it("无 mapFn（对照）：元素域保持 undefined 字面量（不 mint 下标）", () => {
    const r = call(`export function f(n) { return Array.from({length: n}); }`, "f", [nAbs]);
    const el = ((r.result as Abs).shape as { element: Abs }).element;
    expect(el.term?.op).toBe("lit");
    expect((el.term as { value?: unknown } | undefined)?.value).toBeUndefined();
    expect(el.pred).toBeUndefined();
  });

  it("lit 长度路径不变（负对照）：exact tuple + 具体下标", () => {
    const r = call(`export function f() { return Array.from({length: 3}, (_, i) => [i]); }`);
    const res = r.result as Abs;
    expect(res.conf).toBe("exact");
    const s = res.shape as { k: string; elements: Abs[] };
    expect(s.k).toBe("tuple");
    expect(s.elements).toHaveLength(3);
    expect(
      s.elements.map((e) => litValue((e.shape as { elements: Abs[] }).elements[0]!)),
    ).toEqual([
      { ok: true, value: 0 },
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });
});
