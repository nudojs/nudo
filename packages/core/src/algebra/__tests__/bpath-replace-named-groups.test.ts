/**
 * 评审修复：replace 回调的命名捕获组参数布局。
 * 原生：regex 命名组时 callback 是 (match, ...pN, offset, string, groupsObject)。
 * 此前 slice(1, -2) 会把 groups 对象当成 offset，参数错位。
 * 注意：replace 只替换命中片段，断言整串中的替换结果。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path replace named capture groups", () => {
  it("callback receives offset as a number even with named groups", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(?<b>b)/, (m, g, off) => String(off)); }`,
    );
    // 命中 'b' @1 → 替换为 "1" → "a1c"
    expect(litValue(r.result)).toBe("a1c");
  });

  it("positional capture still works", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(b)/, (m, g, off) => g + ':' + off); }`,
    );
    expect(litValue(r.result)).toBe("ab:1c");
  });

  it("string pattern callback still gets offset", () => {
    const r = call(
      `export function f() { return 'abc'.replace('b', (m, off) => String(off)); }`,
    );
    expect(litValue(r.result)).toBe("a1c");
  });

  it("named group capture value is still delivered as positional", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(?<b>b)/, (m, g) => '[' + g + ']'); }`,
    );
    expect(litValue(r.result)).toBe("a[b]c");
  });
});
