/**
 * Bug 330 回归：`Array.prototype.join/toString/toLocaleString` 的
 * **nullish 接收者**必须记抛（ToObject）——不再让 L2 门禁假绿。
 *
 * ES 语义（node 实测）：`Array.prototype.join.call(null)` /
 * `.call(undefined)` / `Array.prototype.join()` ⇒ TypeError
 * "Cannot convert undefined or null to object"（ToObject 前置校验）。
 * 同一对象上的其它方法（slice / indexOf / map）本就正确报红。
 *
 * 修复前：`arrayMethodAbs` 的 apply 用 `a[0] ?? undefAbs()` 把 nullish
 * 接收者**静默替换**成 undefined 值 ⇒ brand 判定（ToObject）从未发生
 * ⇒ 全程不记抛 ⇒ 导出函数被引擎判成 total ⇒ L2 门禁 0 诊断（假绿）。
 *
 * 负控制钉住：非 nullish 接收者（数组 / array-like / 字符串 / 数字 /
 * 对象）仍**不抛**；`String(arr)` / 模板串 / `arr.join()` 等 ToString
 * 通道不受影响；同对象上其它方法的既有报红不变。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

/** 是否 definite throw（结果面是 never + throws 面是具名 brand） */
function isDefiniteThrow(src: string, name: string): boolean {
  const rec = call(src, "f");
  const t = rec.throws as { shape?: { k?: string; name?: string } } | undefined;
  return (
    rec.result.shape.k === "never" &&
    !!t?.shape &&
    t.shape.k === "brand" &&
    t.shape.name === name
  );
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 330 — Array.prototype 三键的 nullish 接收者记抛", () => {
  it("join.call(null) / join.call(undefined) ⇒ TypeError（改前不记抛）", () => {
    for (const body of [
      `return Array.prototype.join.call(null);`,
      `return Array.prototype.join.call(undefined);`,
      `return Array.prototype.join.call();`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
      expect(throwName(src), body).toBe("TypeError");
    }
  });

  it("toString.call(null) / toString.call(undefined) ⇒ TypeError", () => {
    for (const body of [
      `return Array.prototype.toString.call(null);`,
      `return Array.prototype.toString.call(undefined);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("toLocaleString.call(null) / toLocaleString.call(undefined) ⇒ TypeError", () => {
    for (const body of [
      `return Array.prototype.toLocaleString.call(null);`,
      `return Array.prototype.toLocaleString.call(undefined);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("摘下方法值后以 null 调用 ⇒ TypeError（原生同）", () => {
    const src = wrap(`const a = [1,2]; const j = a.join; return j.call(null);`);
    expect(isDefiniteThrow(src, "TypeError")).toBe(true);
  });
});

describe("Bug 330 负控制：非 nullish 接收者不抛", () => {
  it("数组接收者仍折出值（原生 \"1,2\"）", () => {
    expect(v(wrap(`return Array.prototype.join.call([1,2]);`))).toEqual({
      ok: true,
      value: "1,2",
    });
    expect(v(wrap(`return Array.prototype.toString.call([1,2]);`))).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("array-like / 字符串 / 数字 / 对象接收者不抛", () => {
    for (const body of [
      `return Array.prototype.join.call({length:2,0:"a",1:"b"});`,
      `return Array.prototype.join.call("ab");`,
      `return Array.prototype.join.call(5);`,
      `return Array.prototype.join.call({});`,
      `return Array.prototype.toString.call({});`,
      `return Array.prototype.toLocaleString.call({});`,
    ]) {
      const src = wrap(body);
      expect(throwName(src), body).toBe("");
    }
  });

  it("实例方法调用不受影响（原生 \"1,2\"）", () => {
    expect(v(wrap(`const a = [1,2]; return a.join(",");`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`const a = [1,2]; return a.toString();`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`const a = [1,2]; return a.toLocaleString();`))).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("ToString 通道不受影响（原生 \"1,2\"）", () => {
    // String([1,2]) 的读面是抽象 string（既有精度债）——只钉「不抛」
    const s1 = wrap(`return String([1,2]);`);
    expect(throwName(s1)).toBe("");
    expect(call(s1, "f").result.shape.k).toBe("prim");
    expect(v(wrap(`return \`\${[1,2]}\`;`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`return [1,2] + "";`))).toEqual({ ok: true, value: "1,2" });
  });

  it("同对象上其它方法的既有报红不变（原生 TypeError）", () => {
    for (const body of [
      `return Array.prototype.slice.call(null);`,
      `return Array.prototype.indexOf.call(null);`,
      `return Array.prototype.map.call(null, x => x);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("L2 门禁不再假绿：nullish 接收者的导出函数被判 may-throw", () => {
    // 改前：引擎不记抛 ⇒ 导出函数被判 total ⇒ 0 诊断（假绿）
    const r = checkSource(
      "/t/bug330-nullrecv.js",
      `export function joinCallNull() {
  return Array.prototype.join.call(null);
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("L2 门禁负控制：非 nullish 接收者仍是 total（0 诊断）", () => {
    const r = checkSource(
      "/t/bug330-ok.js",
      `export function joinCallArray() {
  return Array.prototype.join.call([1, 2]);
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});
