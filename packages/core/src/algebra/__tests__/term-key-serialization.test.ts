/**
 * termKey 序列化逐字节等价（2026-11-12 冷路径改动）。
 *
 * 把 `args.map(termKey).join(",")` 换成循环字符串累加后，键必须与改动前
 * **逐字符一致**：键是 Abs 身份 / memo / 指纹的唯一依据，任何字符差异都会
 * 造成陈旧命中或错误 miss。本文件用改动前的参考实现逐条对照，覆盖嵌套、
 * 空参数、各类字面量（-0/NaN/bigint/字符串）与 α-rename。
 */
import { describe, it, expect } from "vitest";
import { termKey, type VarRename } from "../key/abs-key.ts";
import { app, lit, litKeyString, v, type Term } from "../term.ts";

/** 2026-11-12 之前的实现（map + join），只作对照，不参与引擎 */
function referenceKey(t: Term, rename?: VarRename): string {
  switch (t.op) {
    case "lit":
      return `L:${typeof t.value}:${litKeyString(t.value)}`;
    case "var":
      return `V:${rename?.get(t.id) ?? t.id}`;
    case "app":
      return `A:${t.fn}(${t.args.map((a) => referenceKey(a, rename)).join(",")})`;
  }
}

const cases: Term[] = [
  lit(1),
  lit(-0),
  lit(0),
  lit(NaN),
  lit(10n),
  lit("a,b"),
  lit(""),
  lit(null),
  lit(undefined),
  lit(true),
  v("x"),
  v("len#3"),
  app("+", []),
  app("+", [v("x"), lit(1)]),
  app("Math.max", [app("+", [v("a"), lit(2)]), app("*", [lit(-0), lit(3)])]),
  app("get", [v("o"), lit("id"), app("-", [v("n"), lit(1)])]),
];

describe("termKey 逐字节等价", () => {
  it("无 rename：所有形态与改动前参考实现一致", () => {
    for (const t of cases) expect(termKey(t)).toBe(referenceKey(t));
  });

  it("有 rename：var 重锚与嵌套子树一致", () => {
    const rename: VarRename = new Map([
      ["x", "α0"],
      ["a", "α1"],
      ["o", "α2"],
      ["n", "α3"],
    ]);
    for (const t of cases) expect(termKey(t, rename)).toBe(referenceKey(t, rename));
  });

  it("-0 与 0、bigint 与 number 不撞键", () => {
    expect(termKey(lit(-0))).not.toBe(termKey(lit(0)));
    expect(termKey(lit(10n))).not.toBe(termKey(lit(10)));
  });

  it("同一对象重复调用稳定（纯函数，无隐藏状态）", () => {
    const t = app("+", [v("x"), lit(1)]);
    expect(termKey(t)).toBe(termKey(t));
    expect(termKey(t)).toBe(referenceKey(t));
  });
});
