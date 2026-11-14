/**
 * ADR 0001 阶段 1 · 切片 3：绑定索引 `entries` 精度回归。
 *
 * 这两条是「默认切换到索引普查面」的前置条件（§15 实验暴露的 4 条真实回归
 * 的两个根因）：
 * - BUG-996：`objectPropertyKeys` 曾把 CJS 对象字面量的 getter / setter
 *   当成可调用入口（ObjectMethod 恒被 `isFunctionValue` 认作函数值）；
 * - BUG-1149 / 1159：`FunctionDeclaration` 无条件进普查，函数体内**嵌套**
 *   声明也被当成模块顶层入口 ⇒ 名字解析不到 ⇒ 假 `nudo:opaque-result`。
 *
 * 断言同时覆盖「索引面」与「开启开关后的 check 门禁面」，防止只修一半。
 */
import { describe, it, expect, afterEach } from "vitest";
import { parseSource } from "../parse-source.ts";
import { checkSource, pTrue } from "../index.ts";
import { buildSemanticIndex } from "../scan/semantic-index.ts";
import { setSemanticIndexEntryFace } from "../scan/entry-face-shadow.ts";

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

/** 交付默认态：索引面开启（afterEach 恢复，避免用例间串开关）。 */
afterEach(() => setSemanticIndexEntryFace(true));

describe("ADR 0001 阶段 1 · 切片 3 entries 精度", () => {
  it("CJS getter / setter 不进索引入口表，普通方法仍进（BUG-996）", () => {
    expect(entriesOf(GETTER)).toEqual([]);
    expect(entriesOf(SETTER)).toEqual([]);
    expect(entriesOf(PLAIN_METHOD)).toEqual(["f"]);
  });

  it("开启切换后 getter / setter 不造假诊断（BUG-996 check 面）", () => {
    setSemanticIndexEntryFace(true);
    for (const [label, src] of [["getter", GETTER], ["setter", SETTER]] as const) {
      const codes = codesOf(src, label);
      expect(codes).not.toContain("nudo:opaque-result");
      expect(codes).not.toContain("nudo:entry-may-throw");
    }
  });

  it("嵌套函数声明 / 箭头不进索引入口表（BUG-1149 / 1159）", () => {
    expect(entriesOf(NESTED_FN)).toEqual(["f"]);
    expect(entriesOf(NESTED_ARROW)).toEqual(["f"]);
    expect(entriesOf(LOCAL_GETTER)).toEqual(["f"]);
  });

  it("开启切换后嵌套声明不引发假 opaque-result（BUG-1149 / 1159 check 面）", () => {
    setSemanticIndexEntryFace(true);
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
});
