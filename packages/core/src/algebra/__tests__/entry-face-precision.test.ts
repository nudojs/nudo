/**
 * check 入口面精度：语义索引是 `check` 入口表的唯一来源。
 *
 * 前两组是入口表的两个精度回归（索引切换实验暴露的真实回归根因）：
 * - 入口表成员筛选曾把 CJS 对象字面量的 getter / setter 当成可调用入口
 *   （ObjectMethod 恒被认作函数值）；
 * - 1149 / 1159：`FunctionDeclaration` 曾无条件进入口表，函数体内**嵌套**
 *   声明也被当成模块顶层入口 ⇒ 名字解析不到 ⇒ 假 `nudo:opaque-result`。
 *
 * 断言同时覆盖「索引面」与「check 门禁面」，防止只修一半。后三条钉住单点
 * 事实本身：签名序 = 索引登记序、`addedNames` 由索引独有形态派生、namespace
 * 体不是模块顶层。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../parse-source.ts";
import { checkSource, pTrue } from "../index.ts";
import { buildSemanticIndex } from "../scan/semantic-index.ts";
import { listClassEntryNames, listTopFunctions } from "../scan/scan-top-functions.ts";

const GETTER = `module.exports = {
  get f() { return 1; },
};
`;
const SETTER = `module.exports = {
  set f(v) { this._v = v; },
};
`;
const PLAIN_METHOD = `module.exports = {
  f() { return 1; },
};
`;
const NESTED_FN = `export function f() {
  const __sc0 = 42;
  function g() { return 1; }
  const r = (g() && __sc0);
  return r;
}`;
const NESTED_ARROW = `export function f() {
  const g = () => 1;
  return g();
}`;
const LOCAL_GETTER = `export function f() {
  const k = "a";
  const o = { get [k]() { return 1; } };
  return o.a;
}`;

const codesOf = (src: string, name: string): string[] =>
  checkSource(`/t/precision/${name}.js`, src, pTrue, {}).issues.map((i) => i.code);
const entriesOf = (src: string): readonly string[] =>
  buildSemanticIndex(parseSource(src)).entries;
const signatureNamesOf = (src: string): string[] =>
  checkSource("/t/precision/order.ts", src, pTrue, {}).signatures.map((s) => s.name);

describe("check 入口面精度", () => {
  it("CJS getter / setter 不进入口表，普通方法仍进（BUG-996）", () => {
    expect(entriesOf(GETTER)).toEqual([]);
    expect(entriesOf(SETTER)).toEqual([]);
    expect(entriesOf(PLAIN_METHOD)).toEqual(["f"]);
  });

  it("getter / setter 不造假诊断（BUG-996 check 面）", () => {
    for (const [label, src] of [["getter", GETTER], ["setter", SETTER]] as const) {
      const codes = codesOf(src, label);
      expect(codes).not.toContain("nudo:opaque-result");
      expect(codes).not.toContain("nudo:entry-may-throw");
    }
  });

  it("嵌套函数声明 / 箭头不进入口表（BUG-1149 / 1159）", () => {
    expect(entriesOf(NESTED_FN)).toEqual(["f"]);
    expect(entriesOf(NESTED_ARROW)).toEqual(["f"]);
    expect(entriesOf(LOCAL_GETTER)).toEqual(["f"]);
  });

  it("嵌套声明不引发假 opaque-result（BUG-1149 / 1159 check 面）", () => {
    for (const [label, src] of [
      ["nested-fn", NESTED_FN],
      ["nested-arrow", NESTED_ARROW],
      ["local-getter", LOCAL_GETTER],
    ] as const) {
      expect(codesOf(src, label)).not.toContain("nudo:opaque-result");
    }
  });

  it("顶层导出函数不受作用域门控影响（对照组）", () => {
    const src = `export function f() { return 1; }\nexport const g = () => 2;`;
    expect(entriesOf(src)).toEqual(["f", "g"]);
  });

  it("签名序 = 索引登记序（不取旧函数普查序）", () => {
    // 旧普查面：类方法由语句序触发器排在前；索引：声明先登记，类方法后补
    const src = `class Hidden { run(): number { return 1; } }
export const svc = new Hidden();
export function f(): number { return svc.run(); }`;
    expect([...listTopFunctions(src), ...listClassEntryNames(src)]).toEqual([
      "Hidden.run",
      "f",
    ]);
    expect(signatureNamesOf(src)).toEqual(["f", "Hidden.run"]);
    expect(signatureNamesOf(src)).toEqual([...entriesOf(src)]);
  });

  it("索引独有形态派生 addedNames：右值是标识符的 CJS 槽仍被执法（BUG-002）", () => {
    const src = `function boom(): never { throw new Error("boom"); }
exports.greet = boom;`;
    expect(entriesOf(src)).toEqual(["boom", "greet"]);
    const report = checkSource("/t/precision/bug002.js", src, pTrue, {});
    expect(report.issues.map((i) => `${i.fn} ${i.code}`)).toEqual([
      "greet nudo:entry-may-throw",
    ]);
  });

  it("namespace 体不是模块顶层：内部声明不进入口表、不产生噪声诊断", () => {
    const src = `export namespace N {
  export function f(): number { return null.x; }
}
export function g(): number { return N.f(); }`;
    expect(entriesOf(src)).toEqual(["g"]);
    const report = checkSource("/t/precision/ns.ts", src, pTrue, {});
    expect(report.signatures.map((s) => s.name)).toEqual(["g"]);
    expect(report.issues.map((i) => `${i.fn} ${i.code}`)).toEqual([
      "g nudo:entry-may-throw",
    ]);
  });
});
