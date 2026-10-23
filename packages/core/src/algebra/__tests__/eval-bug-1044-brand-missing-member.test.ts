/**
 * Bug 1044 —— **brand 接收者**的「确定缺失」判定（族 46 · 片 S12）。
 *
 * 背景（族 35 · 片 S1 的遗留）：
 * env node 的 `Response.json(...)` 返回域已修对（brand `Response`），但
 * `Response.json(x).then(cb)` **仍不被 L2 门禁标出** ⇒ L2 假绿只关了一半。
 * 根因在 core：`definitelyUncallableMember` 首行 `if (s.k !== "obj") return false;`
 * ⇒ 只判**平 obj 接收者**；brand 接收者的缺槽成员被调用时**不记抛**。
 * （web env 能标出，只因它把 `Response` 建成**平 obj** ⇒ 同一个缺陷 env 侧
 * 表现不一致：web 假红 / node 假绿。）
 *
 * 修法：brand 接收者 ⇒ 取内层 shape；**内层是闭合 obj** ⇒ 走既有「表外 ⇒
 * 确定缺失」逻辑；**内层不是闭合 obj** ⇒ 维持现状（不记抛）。
 *
 * 口径要点（soundness 护栏）：
 * - 内层 unknown / prim / arr / open / 带 index 键 ⇒ 域不封闭 ⇒ 不判；
 * - 引擎已为该 brand 建模原型面（内建 brand / 装箱 brand / Proxy / Intl.* /
 *   原型对象 brand）⇒ 表外名**不可证缺席** ⇒ 不判；
 * - 注册用户类（类注册表持有原型方法面）⇒ 不判（域不同）；
 * - Object.prototype 名 ⇒ 原型上恒有 ⇒ 不判。
 *
 * 本文件同时是**同步守卫**：`exec/runtime/members.ts` 的两张内建 brand 原型
 * 表的键集必须 ⊆ `PROTOTYPED_BRAND_NAMES`（新增内建 brand 时同步排除名单，
 * 否则本守卫会红 ⇒ 防止「漏排除 ⇒ 合法调用被误判成确定抛」的假红）。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "../abs.ts";
import { objOf } from "../objects.ts";
import { absFunction } from "../abs-fn.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import {
  definitelyUncallableMember,
  PROTOTYPED_BRAND_NAMES,
} from "../exec/member-diag.ts";
import {
  BUILTIN_BRAND_METHODS,
  BUILTIN_BRAND_ACCESSORS,
} from "../exec/runtime/members.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { isNever, throwsError } from "./eval-helpers.ts";
import { l2Count } from "./nudo-constraints.ts";

const strPrim: Abs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numPrim: Abs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

/** env 形 brand：内层是**闭合** obj（objOf ⇒ closed + exact） */
function envBrand(name: string, slots: Record<string, Abs>): Abs {
  const wrapped: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) wrapped[k] = { value: v };
  return abs({ k: "brand", name, shape: objOf(wrapped) }, undefined, undefined, "path");
}

/** 内层是 **unknown** 的 brand（域不封闭 ⇒ 缺席不可证） */
function unknownInnerBrand(name: string): Abs {
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "unknown" }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "path",
  );
}

/** 内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭 */
function openInnerBrand(name: string): Abs {
  return abs(
    {
      k: "brand",
      name,
      shape: abs(
        { k: "obj", slots: {}, open: true, index: { key: strPrim, value: strPrim } },
        undefined,
        undefined,
        "exact",
      ),
    },
    undefined,
    undefined,
    "path",
  );
}

/** 跑一段源码（可注入 env 全局），返回求值结果与 throws 面 */
function evalSrc(
  src: string,
  globals: Record<string, Abs> = {},
): { result: Abs; throws: unknown } {
  const exports = runTranspiled(src, { mode: "analyze", envGlobals: globals });
  const rec = callTranspiledExportFull(exports, "f", []);
  return { result: rec.result as Abs, throws: rec.throws };
}

/** env 声明形的 Response 实例面（Bug 1044 的形状）：json / text / status 在槽表里 */
const jsonFn = absFunction([], { apply: () => strPrim }, { name: "json" });
const textFn = absFunction([], { apply: () => strPrim }, { name: "text" });
const RESPONSE = envBrand("Response", {
  status: numPrim,
  ok: abs({ k: "prim", type: "boolean" }, undefined, undefined, "path"),
  json: jsonFn,
  text: textFn,
});

describe("Bug 1044 · brand 接收者的「确定缺失」判定", () => {
  it("brand 接收者 · 闭合 obj · 表外成员（then）⇒ 记 may-throw（never throws TypeError）", () => {
    const r = evalSrc(`export function f() { return resp.then(function () {}); }`, {
      resp: RESPONSE,
    });
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("brand 接收者 · 闭合 obj · 表内成员（json / text）⇒ 不记抛", () => {
    const r1 = evalSrc(`export function f() { return resp.json(); }`, { resp: RESPONSE });
    expect(isNever(r1.result)).toBe(false);
    expect(throwsError(r1.throws, "TypeError")).toBe(false);
    const r2 = evalSrc(`export function f() { return resp.text(); }`, { resp: RESPONSE });
    expect(isNever(r2.result)).toBe(false);
    expect(throwsError(r2.throws, "TypeError")).toBe(false);
  });

  it("负控：宿主确实存在的成员（status / ok —— 数据成员）⇒ 不误报成「确定抛」", () => {
    // status / ok 是数据成员（原生不是函数）⇒ 原生调用确实抛 TypeError；
    // 但 env 声明的是**抽象 prim**（值域非确定）⇒ 不得按「字面量」定论。
    const r = evalSrc(`export function f() { return resp.status(); }`, { resp: RESPONSE });
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("soundness 护栏：内层 **unknown** 的 brand ⇒ 不记抛（域不封闭 ⇒ 缺席不可证）", () => {
    const r = evalSrc(`export function f() { return u.then(function () {}); }`, {
      u: unknownInnerBrand("UnknownThing"),
    });
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(definitelyUncallableMember(unknownInnerBrand("UnknownThing"), "then")).toBe(false);
  });

  it("soundness 护栏：内层 **open** obj 的 brand ⇒ 不记抛", () => {
    const r = evalSrc(`export function f() { return o.then(function () {}); }`, {
      o: openInnerBrand("OpenThing"),
    });
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(definitelyUncallableMember(openInnerBrand("OpenThing"), "then")).toBe(false);
  });

  it("平 obj 接收者的既有行为逐字不变（表外成员仍定抛 / 表内成员不抛）", () => {
    const plain = objOf({ a: { value: numPrim } });
    const missing = evalSrc(`export function f() { return p.nope(); }`, { p: plain });
    expect(isNever(missing.result)).toBe(true);
    expect(throwsError(missing.throws, "TypeError")).toBe(true);
    const inTable = evalSrc(`export function f() { return p.a(); }`, { p: plain });
    expect(isNever(inTable.result)).toBe(false);
    expect(throwsError(inTable.throws, "TypeError")).toBe(false);
  });

  it("负控：引擎已为原型面建模的内建 brand ⇒ 不判（表外名不可证缺席）", () => {
    // Map / ArrayBuffer 的原型可调用面在 members.ts 的 BUILTIN_BRAND_METHODS，
    // 不在内层 obj 槽表里 ⇒ 「get」/「slice」不可按「表外 ⇒ 确定不存在」判。
    for (const expr of [
      `export function f() { return new Map().get("k"); }`,
      `export function f() { return new ArrayBuffer(8).slice(0); }`,
      `export function f() { return new Date().getTime(); }`,
    ]) {
      const r = evalSrc(expr);
      expect(isNever(r.result)).toBe(false);
      expect(throwsError(r.throws, "TypeError")).toBe(false);
    }
  });

  it("L2 门禁面：brand 表外成员的调用 ⇒ 记 nudo:entry-may-throw（假绿收口）", () => {
    const SRC = `
export function f() {
  return resp.then(function () {});
}
`;
    const report = checkSource("/t/bug-1044-brand-missing.js", SRC, pTrue, {
      inject: { envGlobals: { resp: RESPONSE } },
    });
    expect(l2Count(report, "f")).toBeGreaterThan(0);
  });

  it("L2 门禁面：brand 表内成员的调用 ⇒ 不记 entry-may-throw", () => {
    const SRC = `
export function f() {
  return resp.json();
}
`;
    const report = checkSource("/t/bug-1044-brand-in-table.js", SRC, pTrue, {
      inject: { envGlobals: { resp: RESPONSE } },
    });
    expect(l2Count(report, "f")).toBe(0);
  });

  it("同步守卫：内建 brand 原型表键集 ⊆ 排除名单（含 .prototype / Intl. 模式）", () => {
    const engineModelled = new Set([
      ...Object.keys(BUILTIN_BRAND_METHODS),
      ...Object.keys(BUILTIN_BRAND_ACCESSORS),
    ]);
    // 排除口径 = 显式名单 ∪ 三个模式（原型对象 brand / Intl.* 子构造器）
    const covered = (n: string) =>
      PROTOTYPED_BRAND_NAMES.has(n) ||
      n.endsWith(".prototype") ||
      n.endsWith(".generatorProto") ||
      n.startsWith("Intl.");
    const missing = [...engineModelled].filter((n) => !covered(n));
    expect(missing).toEqual([]);
  });

  it("负控：原型对象 brand / Intl.* 子构造器 ⇒ 不判（模式排除生效）", () => {
    for (const name of [
      "Map.prototype",
      "Set.prototype",
      "Symbol.prototype",
      "Intl.NumberFormat",
      "Intl.DateTimeFormat",
    ]) {
      const b = envBrand(name, { x: numPrim });
      expect(definitelyUncallableMember(b, "nope")).toBe(false);
    }
  });
});
