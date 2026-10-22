/**
 * Bug 277 —— CJS **顶层 `this`** 是 `undefined`（原生是 `module.exports`）
 * → 整个模块**定抛** ⇒ 假绿。
 *
 * 改前：CJS 前导只造 `exports` / `module`，**不绑 `this`**；转译器又把
 * 顶层 `this` 折成 `$lit(void 0)`（ESM 语义）⇒ `this.x = v` 写 undefined
 * ⇒ TypeError ⇒ 模块装载失败 ⇒ 全文件退化 unknown ⇒ 门禁绿灯。
 *
 * 改后：CJS 源给转译器 `thisParam`（顶层 this → 模块级绑定
 * `__nudoCjsThis`），CJS 前导把它绑到 `exports`（=== `module.exports`
 * 的同一对象）⇒ `this.x = v` 对 `module.exports` 可见（原生同口径）。
 * ESM 源保持 `undefined`（原生 ESM 顶层 this 就是 undefined）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue } from "../abs.ts";

describe("Bug 277：CJS 顶层 this === module.exports", () => {
  it("this.x = v 对 module.exports 可见（不再定抛）", () => {
    const src = `this.answer = 42;
module.exports.probe = function(){ return module.exports.answer; };
export function f() { return module.exports.answer; }`;
    const exports = runTranspiled(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 42 });
  });

  it("只用顶层 this 的 CJS 源（无 export 语法）：this.x = v 不再定抛，槽进导出面", () => {
    // 原生 CJS：`this` === module.exports ⇒ `this.answer = 7` ⇒ 导出 { answer: 7 }
    const src = `this.answer = 7;`;
    const exports = runTranspiled(src, { mode: "exec" });
    expect(litValue(exports["answer"] as never)).toEqual({ ok: true, value: 7 });
  });

  it("ESM 源顶层 this 仍是 undefined（原生一致）⇒ this.x = v 抛", () => {
    const src = `export function f() { return 1; }
this.x = 1;`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow();
  });
});
