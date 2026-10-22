/**
 * Bug 287 —— 导出名回收正则的捕获组是 **ASCII-only**（`\w`）⇒ 任何含
 * **`$`** 或**非 ASCII** 字符的**导出函数名被整条丢掉**：函数体**从不被
 * 分析** ⇒ 签名塌 `unknown` ⇒ 追加**假** `nudo:unknown-inference` ⇒
 * L2 `nudo:entry-may-throw` 门禁假绿。
 *
 * 改前：`/^export function (\w+)/gm` / `/^export (?:const|let) (\w+)/gm`
 * —— `\w` 只认 ASCII 字母数字下划线。
 * 改后：捕获组放宽为 JS 标识符（`$` / `_` / Unicode ID_Start 开头，
 * ID_Continue 后续），与 `export * as` 的名口径同源（IDENT_NAME_SRC）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { stripStaticExportDecls } from "../exec/export-names.ts";
import { transpile } from "../exec/transpile.ts";
import { litValue } from "../abs.ts";

describe("Bug 287：导出名回收覆盖 $ / 非 ASCII", () => {
  it("含 $ 的导出函数名被回收", () => {
    const exports = runTranspiled(`export function $d(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["$d"]);
  });

  it("含非 ASCII 的导出函数名被回收", () => {
    const exports = runTranspiled(`export function 导出(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["导出"]);
  });

  it("含 $ / 非 ASCII 的导出 const 名被回收", () => {
    const exports = runTranspiled(`export const $c = 7;\nexport const 数 = 8;`, {
      mode: "exec",
    });
    expect(Object.keys(exports).sort()).toEqual(["$c", "数"]);
  });

  it("导出函数**被分析**（throws 面如实，不再从不被分析）", () => {
    const exports = runTranspiled(`export function $d(x) { return null.x; }`, {
      mode: "exec",
    });
    const full = callTranspiledExportFull(exports, "$d", []);
    expect(full.throws?.shape?.k ?? "never").toBe("brand");
  });

  it("stripStaticExportDecls 文本口径也放宽（$ / 非 ASCII）", () => {
    expect(stripStaticExportDecls(transpile(`export function $d(){}`)).names).toEqual([
      "$d",
    ]);
    expect(stripStaticExportDecls(transpile(`export function 导出(){}`)).names).toEqual([
      "导出",
    ]);
  });

  it("ASCII 同形口径不变（对照组）", () => {
    const exports = runTranspiled(`export function ascii(x) { return x + 1; }`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["ascii"]);
    expect(litValue(exports["ascii"] as never)).toEqual({ ok: false });
  });
});
