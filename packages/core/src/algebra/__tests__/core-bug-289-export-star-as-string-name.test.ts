/**
 * Bug 289 —— `export * as "<任意名>" from "..."`（ES2022 任意模块导出名）
 * **不被转译** ⇒ 转译产物是**非法 JS** ⇒ **整个模块**求值失败 ⇒ 全部
 * 导出被静默清空 ⇒ L1 门禁假绿。
 *
 * 改前：`rewriteExportStatements` 的正则只认标识符名
 * （`([A-Za-z_$][\w$]*)`）⇒ 字符串字面量名（`"my-ns"`）不匹配 ⇒ 语句
 * 原样泄漏 ⇒ `new Function` SyntaxError。
 * 改后：名可标识符或**字符串字面量**（标识符口径与 export-names.ts 同一
 * IDENT_NAME_SRC）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { abs, litValue } from "../abs.ts";
import { pTrue } from "../pred.ts";

const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");

describe("Bug 289：export * as \"<名>\" 被转译（模块不再整体求值失败）", () => {
  it("字符串字面量导出名：模块正常求值且带出该导出", () => {
    const src = `export * as "my-ns" from "./dep.js";
export function f() { return 5; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./dep.js": { named: { five: num(5) } } },
    });
    expect(Object.keys(exports).sort()).toEqual(["f", "my-ns"]);
    expect(litValue(callTranspiledExportFull(exports, "f", []).result)).toEqual({
      ok: true,
      value: 5,
    });
  });

  it("标识符导出名口径不变（对照组）", () => {
    const src = `export * as ns from "./dep.js";
export function f() { return 5; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./dep.js": { named: { five: num(5) } } },
    });
    expect(Object.keys(exports).sort()).toEqual(["f", "ns"]);
  });

  it("无 export * as 的普通模块不受影响（对照组）", () => {
    const exports = runTranspiled(`export function f() { return 5; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["f"]);
  });
});
