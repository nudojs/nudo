/**
 * Bug 288 — 宿主全局 `structuredClone` 的**抽象实参**一律记 may `TypeError`
 * ⇒ ① 可克隆形态（普通对象 / 数组 / Date / Map / Set / RegExp）**假红**
 * （L1/L2 门禁红，而 native 不抛）；② 不可克隆形态（Symbol / 函数 /
 * WeakMap / Promise）**抛错类型错**（native 抛 `DOMException`
 * `DataCloneError`，引擎记 `TypeError`）⇒ 契约面写不出
 * `@nudo:throws DataCloneError`。
 *
 * 根因：`exec/calls.ts` 的 `callHostGlobalLiteralOnly` 对**任一**抽象实参
 * 一律记 may `TypeError`（cause 写「Symbol coercion」）——那条推理只对
 * 「对实参做 ToString / ToNumber」的宿主函数成立（parseInt / Number /
 * decodeURIComponent / btoa …），而 `structuredClone` 走**结构化克隆算法**
 * （完全不对实参做 ToString）⇒ 该 cause 与它代表的推理在 `structuredClone`
 * 上不成立。
 *
 * 修法：把 `structuredClone` 从「抽象实参一律抛」里**排除**，按实参形态
 * 的**可克隆性**分档——可克隆形态不记抛；不可克隆形态记
 * **`DataCloneError`**（宿主 DOMException 的 name，**不是** `TypeError`）。
 *
 * 证据口径：原生 oracle（同进程真实 `structuredClone`）+ 引擎探针。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { call, isNever, throwsError, effects } from "./eval-helpers.ts";
import { l2Count } from "./nudo-constraints.ts";

function check(src: string) {
  return checkSource("/t/core-bug-288.js", src, pTrue, {});
}

/** 引擎侧 throws 面名（brand 名 / never） */
function throwsName(t: unknown): string {
  const s = (t as { shape?: { k?: string; name?: string } } | undefined)?.shape;
  if (!s || s.k === "never") return "never";
  return s.k === "brand" ? (s.name ?? "brand") : (s.k ?? "never");
}

/** 可克隆形态：native 不抛 ⇒ 引擎不得记抛（原口径是假红） */
const CLONEABLE: Array<[string, string]> = [
  ["plain object", `return structuredClone({ a: 1 });`],
  ["nested object", `return structuredClone({ a: { b: [1, 2] } });`],
  ["array", `return structuredClone([1, 2]);`],
  ["Date", `return structuredClone(new Date(0));`],
  ["Map", `return structuredClone(new Map([[1, 2]]));`],
  ["Set", `return structuredClone(new Set([1]));`],
  ["RegExp", `return structuredClone(/x/g);`],
  ["user class instance", `class C { constructor() { this.a = 1; } }\nreturn structuredClone(new C());`],
  ["alias of host fn", `const f = structuredClone;\nreturn f({ a: 1 });`],
];

/** 不可克隆形态：native 抛 DataCloneError ⇒ 引擎须记 DataCloneError */
const NOT_CLONEABLE: Array<[string, string]> = [
  ["symbol", `return structuredClone(Symbol("x"));`],
  ["arrow fn", `return structuredClone(() => 1);`],
  ["function decl", `return structuredClone(function f() { return 1; });`],
  ["WeakMap", `return structuredClone(new WeakMap());`],
  ["Promise", `return structuredClone(Promise.resolve(1));`],
  ["object with fn prop", `return structuredClone({ f: () => 1 });`],
  ["nested fn prop", `return structuredClone({ a: { b: () => 1 } });`],
  ["class with fn prop", `class C { constructor() { this.f = () => 1; } }\nreturn structuredClone(new C());`],
];

describe("Bug 288 — structuredClone 按可克隆性分档（不再一律 may TypeError）", () => {
  it("原生 oracle：可克隆形态不抛 / 不可克隆形态抛 DataCloneError", () => {
    expect(structuredClone({ a: 1 })).toEqual({ a: 1 });
    expect(structuredClone(new Date(0))).toBeInstanceOf(Date);
    expect(structuredClone([1, 2])).toEqual([1, 2]);
    let name = "";
    try {
      structuredClone(Symbol("x"));
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name, "native 抛 DOMException(DataCloneError)").toBe("DataCloneError");
    let fnName = "";
    try {
      structuredClone(() => 1);
    } catch (e) {
      fnName = (e as Error).name;
    }
    expect(fnName).toBe("DataCloneError");
  });

  it.each(CLONEABLE)("可克隆形态（%s）：零 throws 面（native 不抛 ⇒ 原口径是假红）", (_name, body) => {
    const rec = call(`export function f() {\n${body}\n}`, "f");
    expect(throwsName(rec.throws), "可克隆形态不得记抛").toBe("never");
    expect(isNever(rec.throws)).toBe(true);
    // 签名面（may-throw 效果的展示位）：原口径在此挂 TypeError ⇒ 假红
    const r = check(`export function f() {\n${body}\n}`);
    expect(r.signatures[0]?.throws, "签名不得带 throws 面").toBeUndefined();
  });

  it.each(NOT_CLONEABLE)("不可克隆形态（%s）：throws 面 = DataCloneError（不是 TypeError）", (_name, body) => {
    const rec = call(`export function f() {\n${body}\n}`, "f");
    expect(throwsName(rec.throws)).toBe("DataCloneError");
    expect(throwsError(rec.throws, "DataCloneError")).toBe(true);
    expect(throwsError(rec.throws, "TypeError"), "不得记 TypeError").toBe(false);
  });

  it("L2 门禁：可克隆形态零 L2（原口径：一条 may throw TypeError 假红）", () => {
    for (const [, body] of CLONEABLE) {
      const r = check(`export function f() {\n${body}\n}`);
      expect(l2Count(r, "f"), `可克隆形态不应报 may-throw：${body}`).toBe(0);
      expect(r.summary.errors).toBe(0);
    }
  });

  it("L2 门禁：不可克隆形态一条 L2（kind = DataCloneError）", () => {
    for (const [, body] of NOT_CLONEABLE) {
      const r = check(`export function f() {\n${body}\n}`);
      expect(l2Count(r, "f"), `不可克隆形态应报 may-throw：${body}`).toBe(1);
      const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
      expect(issue?.message).toContain("DataCloneError");
      expect(issue?.message).not.toContain("TypeError");
    }
  });

  it("契约面：`@nudo:throws DataCloneError` 能申报（原先写不出正确的 kind）", () => {
    const r = check(`/**\n * @nudo:throws DataCloneError\n */\nexport function f() { return structuredClone(() => 1); }`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 展示层仍上屏事实（门禁过滤 ≠ 藏事实）
    expect(r.signatures[0]?.throws).toContain("DataCloneError");
  });

  it("无约束实参（any）：仍诚实记 may-throw，但 kind 是 DataCloneError", () => {
    // 入口无约束 = any = 诚实 may-throw（既定 policy，见 check-entry-may-throw-fp）
    expect(effects(`export function f(x) { return structuredClone(x); }`, "f")).toEqual([
      "DataCloneError",
    ]);
  });

  it("try-catch 消化：native 返回 \"caught\"，引擎同口径（不再假绿）", () => {
    const rec = call(
      `export function f() { try { return structuredClone(() => 1); } catch (e) { return "caught"; } }`,
      "f",
    );
    const lv = rec.result.term;
    expect(lv && lv.op === "lit" ? lv.value : undefined).toBe("caught");
    expect(throwsName(rec.throws)).toBe("never");
  });

  it("对照组：非 structuredClone 的宿主全局仍走原保守口径（parseInt(Symbol) 定抛 TypeError）", () => {
    const rec = call(`export function f() { return parseInt(Symbol("x")); }`, "f");
    expect(throwsName(rec.throws)).toBe("TypeError");
  });
});
