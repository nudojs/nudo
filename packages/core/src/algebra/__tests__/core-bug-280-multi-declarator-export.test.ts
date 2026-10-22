/**
 * Bug 280 —— `export const a = …, b = …`（多声明符）**只有首个声明符进
 * 导出表** → `b` 不是导出 → 签名 `unknown` / 跨模块 import `unknown`。
 *
 * 改前：转译产物对多声明符导出只给**首个**声明符加 `export ` 前缀
 * （`export let a = …; $recordBinding("a", a); let b = …; …`）⇒ 正则只
 * 收到 `a`。**注意**：`export const a=1,b=2` 与 `export const a=1;
 * const b=2` 的转译产物**逐字相同** ⇒ 文本口径**不可区分** ⇒ 只能回
 * **源 AST** 回收第 2+ 个声明符的名字。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../exec/run.ts";
import { litValue } from "../abs.ts";

describe("Bug 280：多声明符导出的第 2+ 个声明符也是导出", () => {
  it("export const a = 1, b = 2 ⇒ a 与 b 都是导出", () => {
    const exports = runTranspiled(`export const a = 1, b = 2;`, { mode: "exec" });
    expect(Object.keys(exports).sort()).toEqual(["a", "b"]);
  });

  it("多声明符的值正确（b = 2）", () => {
    const exports = runTranspiled(`export const a = 1, b = 2;`, { mode: "exec" });
    expect(litValue(exports["b"] as never)).toEqual({ ok: true, value: 2 });
  });

  it("三个声明符全收", () => {
    const exports = runTranspiled(`export const a = 1, b = 2, c = 3;`, {
      mode: "exec",
    });
    expect(Object.keys(exports).sort()).toEqual(["a", "b", "c"]);
  });

  it("对照：独立声明 + 独立 export 只有 a 是导出（b 不是）", () => {
    // 与多声明符的转译产物逐字相同 ⇒ 只有源 AST 能区分二者
    const exports = runTranspiled(`export const a = 1;\nconst b = 2;`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["a"]);
  });

  it("export function / export class 口径不变", () => {
    const exports = runTranspiled(
      `export function f() { return 1; }\nexport class K {}`,
      { mode: "exec" },
    );
    expect(Object.keys(exports).sort()).toEqual(["K", "f"]);
  });
});
