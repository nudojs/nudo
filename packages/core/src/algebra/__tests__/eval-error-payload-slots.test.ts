/**
 * Bug 6（运行时内建建模）：内建抛错载荷 catch 形参的 .name/.message 折
 * undefined——errorTypeAbs 只把错误名放 brand 层（shape.name），内层 obj
 * slots 为空；$get brand 分支自有槽 miss → $get(inner) → 空槽 → undefAbs。
 * 原生：e.name 是品牌名（静态可知）、e.message 恒 string 域。
 * 修复：errorTypeAbs 内层 obj 补 name: strLit(name) / message: str() 槽
 * （与 builtins/error.ts errorBrandAbs 同口径——new TypeError("boom")
 * 的 catch 形参路径本就正确）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, name: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

describe("Bug 6: builtin throw payload catch param has name/message slots", () => {
  it('"a".includes(/a/) 的 catch 形参 e.name → "TypeError"', () => {
    const r = call(
      `export function f(s) { try { return "a".includes(/a/); } catch (e) { return e.name; } }`,
      "f",
      ["unused"],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it('"ab".repeat(-1) 的 catch 形参 e.name → "RangeError"', () => {
    const r = call(
      `export function f(s) { try { return "ab".repeat(-1); } catch (e) { return e.name; } }`,
      "f",
      ["unused"],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "RangeError" });
  });

  it("catch 形参 e.message → string 域（宿主消息串，内容不定域恒 string）", () => {
    const r = call(
      `export function g(s) { try { return "ab".repeat(-1); } catch (e) { return e.message; } }`,
      "g",
      ["unused"],
    );
    expect(formatAbs(r.result)).toContain("string");
  });

  it("JSON.stringify(1n) 的 catch 形参 e.name → TypeError（宿主直调硬抛面）", () => {
    const r = call(
      `export function f() { try { return JSON.stringify(1n); } catch (e) { return e.name; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("对照：throw new TypeError(…) 走 errorBrandAbs，name 折叠不回归", () => {
    const r = call(
      `export function h(s) { try { throw new TypeError("boom"); } catch (e) { return e.name; } }`,
      "h",
      ["unused"],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });
});
