/**
 * Bug 1（运行时内建建模）：String#replace/replaceAll 回调返回 Symbol——
 * 原生 GetSubstitution 对 replacer 返回值做 ToString，Symbol 定抛
 * TypeError（"ab".replace("a", () => Symbol())）；此前 replWrapper 的
 * String(r.term.value) 分支把 symbol-prim（无 lit 项）吞进 anyUnknown →
 * strPrim("path")，确定抛错折成正常返回值，catch 臂 "caught" 也丢失。
 * 修复：shape 判定 symbol（先于 lit 检查）抛宿主 TypeError，外层裸 catch
 * 区分宿主 TypeError → 重抛 NudoThrow(errorTypeAbs("TypeError"))（与
 * replaceAll 非全局正则硬抛同口径）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, name: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

function throwsName(r: { throws: { shape: { k: string; name?: string } } }): string | undefined {
  return r.throws.shape.k === "brand" ? r.throws.shape.name : undefined;
}

describe("Bug 1: replace/replaceAll replacer returning Symbol throws TypeError", () => {
  it('"ab".replace("a", () => Symbol()) → throws TypeError（值 never）', () => {
    const r = call(
      `export function f() { return "ab".replace("a", () => Symbol()); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("try/catch 吸收为 catch 臂值（原生 catch 形参可读）", () => {
    const r = call(
      `export function f() { try { return "ab".replace("a", () => Symbol()); } catch { return "caught"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });

  it('"aa".replaceAll("a", () => Symbol()) → throws TypeError', () => {
    const r = call(
      `export function f() { return "aa".replaceAll("a", () => Symbol()); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("正则 pattern 的 Symbol replacer 同面抛（regex 分支共用 replWrapper）", () => {
    const r = call(
      `export function f() { return "a1b2".replace(/\\d/g, () => Symbol()); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("正常字符串回调不回归（折叠 + 副作用语义保持）", () => {
    const r = call(
      `export function f() { return "a1b2".replace(/\\d/g, (m) => "<" + m + ">"); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a<1>b<2>" });
  });

  it("非 symbol 原始值回调返回（number/null/undefined）仍按 ToString 折叠", () => {
    const r = call(
      `export function f() { return "ab".replace("a", () => 99); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "99b" });
  });
});
