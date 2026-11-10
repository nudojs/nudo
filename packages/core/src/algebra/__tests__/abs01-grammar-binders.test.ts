/**
 * ABS-01：约束 / 引理文法补齐。
 *
 * 覆盖：
 * - `@nudo:assume` / `@nudo:invariant` 的简单算术文法（name / number /
 *   name ± number）；文法外形态仍 fail-closed；
 * - 依赖式返回契约 `@nudo:contract return >= x`（以及 `> x` 的诚实证不出）；
 * - 契约内 binder / ref（`bind` / `ref` / `.at(path)`）的跨槽作用域、
 *   未绑定 ref 的 fail-closed 诊断、数组域口径不因 binder 落地而漂移；
 * - `formatConstraint` 的 bind/ref/rel 数据形态可回写。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  bind,
  ref,
  rel,
  array,
  number,
  shape,
  union,
  any,
} from "../index.ts";
import { extractAssumeSegs, extractInvariantSegs } from "../refine.ts";
import { formatConstraint } from "../contract/contract.ts";
import { makeFiles } from "./nudo-constraints.ts";

const STD = `export const num = number();
export const nonneg = number().ge(0);
export const small = number().ge(0).le(5);
export const ge1 = number().ge(1);
export const ints = array(number());
export const mixed = array(union(number(), string()));`;

function run(source: string, files: Record<string, string> = {}) {
  const all = { "/t/std.nudo.js": STD, ...files };
  const { loadModule } = makeFiles(all);
  return checkSource("/t/x.js", source, pTrue, {
    loadModule,
    fromFile: "/t/x.js",
    entryThrows: "off",
  });
}

const stdImport = `/// @nudo:import { num, nonneg, small, ge1, ints, mixed } from "./std.nudo.js"`;

describe("ABS-01 assume 算术文法", () => {
  it("i + 1 <= n：解析为 expr 项（app +），两侧名字可校验", () => {
    const src = `
/**
 * @nudo:assume i + 1 <= n
 */
export function f(i, n) { return i; }`;
    const segs = extractAssumeSegs(src, "f");
    expect(segs).toHaveLength(1);
    const seg = segs[0]!;
    expect(seg.kind).toBe("ok");
    if (seg.kind !== "ok") return;
    expect(seg.lhs).toBe("i + 1");
    expect(seg.rhs).toBe("n");
    expect(seg.lhsTerm.op).toBe("app");
    expect(seg.rhsNames).toEqual(["n"]);
    expect(seg.lhsNames).toEqual(["i"]);
  });

  it("n >= i + 1：`>=` 在解析期翻转为 le（规范形 i + 1 <= n）", () => {
    const segs = extractAssumeSegs(
      `
/**
 * @nudo:assume n >= i + 1
 */
export function f(i, n) { return i; }`,
      "f",
    );
    const seg = segs[0]!;
    expect(seg.kind).toBe("ok");
    if (seg.kind !== "ok") return;
    expect(seg.lhs).toBe("i + 1");
    expect(seg.rhs).toBe("n");
  });

  it("常数界 d <= 10 合法；乘除 / 括号 / 空操作数仍 malformed", () => {
    const ok = `
/**
 * @nudo:assume d <= 10
 */
export function f(d) { return d; }`;
    expect(extractAssumeSegs(ok, "f").every((s) => s.kind === "ok")).toBe(true);
    for (const bad of ["i * 2 <= n", "i / 2 <= n", "(i + 1) <= n", "i + <= n"]) {
      const src = `
/**
 * @nudo:assume ${bad}
 */
export function f(i, n) { return i; }`;
      const segs = extractAssumeSegs(src, "f");
      expect(segs[0]?.kind, bad).toBe("bad");
    }
  });

  it("算术里的未绑定名仍走 nudo:assume-invalid（fail-closed）", () => {
    const r = run(`
/**
 * @nudo:assume i + zz <= n
 */
export function f(i, n) { return i; }`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.actual).toBe("zz");
  });
});

describe("ABS-01 invariant 关系右端", () => {
  it("i < n：合法且被循环 join/宽化位消费（invariant-relied，display 规范形）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:invariant i < n
 * @nudo:contract return num
 */
export function count(n) {
  let i = 0;
  while (i < n) { i = i + 1; }
  return i;
}`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("i < n");
  });

  it("右端名字未绑定 → warning nudo:invariant-invalid（不影响 ok）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:invariant i < zz
 * @nudo:contract return num
 */
export function count(n) {
  let i = 0;
  while (i < n) { i = i + 1; }
  return i;
}`);
    const bad = r.issues.find((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("warning");
    expect(bad!.actual).toBe("zz");
  });

  it("extractInvariantSegs 携带 rhsTerm / rhsNames（常数右端保留 value 快捷读数）", () => {
    const src = `
/**
 * @nudo:invariant i < n
 * @nudo:invariant last >= 0
 */
export function f(i, n) { return i; }`;
    const segs = extractInvariantSegs(src, "f");
    const rel = segs[0]!;
    expect(rel.kind).toBe("ok");
    if (rel.kind !== "ok") return;
    expect(rel.rhsNames).toEqual(["n"]);
    expect(rel.value).toBeUndefined();
    const lit = segs[1]!;
    expect(lit.kind).toBe("ok");
    if (lit.kind !== "ok") return;
    expect(lit.value).toBe(0);
    expect(lit.rhsTerm).toEqual({ op: "lit", value: 0 });
  });
});

describe("ABS-01 依赖式返回契约（@nudo:contract return <rel> x）", () => {
  it(">= x 对 x + 1 可证（IEEE 舍入单调：round(x+c) >= x）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:contract x num
 * @nudo:contract return >= x
 */
export function inc(x) { return x + 1; }`);
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("> x 对无界 x + 1 诚实证不出（warning，不制造 error；2^53 + 1 = 2^53）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:contract x num
 * @nudo:contract return > x
 */
export function inc(x) { return x + 1; }`);
    const unproven = r.issues.find((i) => i.code === "nudo:unproven-return");
    expect(unproven).toBeDefined();
    expect(unproven!.severity).toBe("warning");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("> x 对常数返回 + 有界参数可证（区间证据）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:contract x small
 * @nudo:contract return > x
 */
export function pick(x) { return 10; }`);
    // 返回项是字面量；参数界不在返回证据里 ⇒ 诚实证不出（warning），不得假绿
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });

  it("未绑定名 → error nudo:contract-param-mismatch（fail-closed）", () => {
    const r = run(`${stdImport}
/**
 * @nudo:contract x num
 * @nudo:contract return > zz
 */
export function inc(x) { return x + 1; }`);
    const bad = r.issues.find((i) => i.code === "nudo:contract-param-mismatch");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
    expect(bad!.actual).toBe("zz");
    expect(r.ok).toBe(false);
  });

  it("关系式右端 malformed（return > / return >+ 1）→ contract-syntax warning", () => {
    const r = run(`${stdImport}
/**
 * @nudo:contract return > 
 */
export function f(x) { return x; }`);
    expect(r.issues.some((i) => i.code === "nudo:contract-syntax")).toBe(true);
  });
});

describe("ABS-01 契约内 binder / ref", () => {
  const binders = {
    "/t/x.nudo.js": `export const processItems = fn({ items: array(bind("a", any())), transform: fn({ x: ref("a") }, bind("b", number())) }, array(ref("b")));`,
  };

  it("返回数组元素域来自 bind 的回调返回域：字符串元素 ⇒ 违约", () => {
    const src = `export function processItems(items, transform) { return ["s"]; }`;
    const r = run(src, binders);
    const bad = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
  });

  it("数字元素通过同一契约（ref 不引入新义务）", () => {
    const r = run(`export function processItems(items, transform) { return [1]; }`, binders);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("调用点：回调返回域与返回数组元素域不一致 ⇒ 违约（跨位绑定）", () => {
    const src = `export function processItems(items, transform) { return items.map(transform); }
export const out = processItems([1, 2], (n) => "s" + n);`;
    const r = run(src, binders);
    const bad = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  it("entry-only（无调用点）：只投影不检查（无违约、无 error）", () => {
    const src = `export function processItems(items, transform) { return items.map(transform); }`;
    const r = run(src, binders);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:contract-load")).toBe(false);
    expect(r.signatures.some((s) => s.name === "processItems")).toBe(true);
  });

  it("未绑定 ref ⇒ contract-load error（不崩溃、不退化成 any）", () => {
    const r = run(`export function f(x) { return [x]; }`, {
      "/t/x.nudo.js": `export const f = fn({ x: number() }, array(ref("zz")));`,
    });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.severity).toBe("error");
    expect(r.issues.some((i) => i.code === "nudo:internal")).toBe(false);
  });

  it("跨树 ref 不可见 ⇒ contract-load（作用域 = 单条约束树）", () => {
    const r = run(`export function f() { return [{ id: "s" }]; }`, {
      "/t/x.nudo.js": `export const a = shape({ id: number() });\nexport const f = fn({}, array(ref("a").at("id")));`,
    });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain('ref("a")');
  });

  it("同一树内 ref(...).at(path) 投影命中字段约束（字符串 id ⇒ 违约）", () => {
    const r = run(`export function f(obj) { return [{ id: "s" }]; }`, {
      "/t/x.nudo.js": `export const f = fn({ obj: bind("a", shape({ id: number() })) }, array(ref("a").at("id")));`,
    });
    const bad = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
  });

  it("数组域口径不因 binder 落地漂移：[1, \"x\"] 对 number ⇒ 违约 / union ⇒ 通过 / bind ⇒ 无同质门", () => {
    const bad = run(`${stdImport}
/**
 * @nudo:contract return ints
 */
export function f() { return [1, "x"]; }`);
    expect(bad.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);

    const ok = run(`${stdImport}
/**
 * @nudo:contract return mixed
 */
export function f() { return [1, "x"]; }`);
    expect(ok.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);

    const anyOk = run(`export function f() { return [1, "x"]; }`, {
      "/t/x.nudo.js": `export const f = fn({}, array(bind("i", any())));`,
    });
    expect(anyOk.ok).toBe(true);
  });
});

describe("ABS-01 约束数据形态", () => {
  it("formatConstraint 回写 bind / ref / rel（builder 数据形态）", () => {
    expect(formatConstraint(bind("a", any()))).toBe('bind("a", any())');
    expect(formatConstraint(array(ref("a")))).toBe('array(ref("a"))');
    expect(formatConstraint(ref("a").at("id"))).toBe('ref("a").at("id")');
    expect(formatConstraint(rel(">", "x"))).toBe('rel(">", "x")');
    expect(formatConstraint(array(bind("b", number())))).toBe(
      'array(bind("b", number()))',
    );
  });

  it("bind/ref/rel 进 CONSTRAINT_BUILDERS（侧车注入面）", async () => {
    const { CONSTRAINT_BUILDERS } = await import("../constraint.ts");
    for (const name of ["bind", "ref", "rel"]) {
      expect(typeof CONSTRAINT_BUILDERS[name]).toBe("function");
    }
  });

  it("at() 只对 ref 合法；非 ref 链上构造期报错", () => {
    expect(() => number().at("id")).toThrow(/only ref/);
  });

  it("union / shape 里的 ref 与 binder 结构数据保留（toPlainConstraint 搬运）", () => {
    const c = array(union(ref("a"), number()));
    expect(formatConstraint(c)).toBe('array(union(ref("a"), number()))');
    const s = shape({ x: bind("a", number()) });
    expect(formatConstraint(s)).toBe('shape({ x: bind("a", number()) })');
  });
});
