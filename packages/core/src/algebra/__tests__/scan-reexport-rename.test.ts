/**
 * 重导出改名：`export { foo as bar } from './other'` 要按 exported 名
 * 匹配、按 local 名跳转。回归背景：旧代码用 local.name === fnName，
 * 查找 bar 时去匹配 foo——跳不过去，侧车/call-graph 落在错误模块。
 * 同类：本地 `export { foo as bar }`（无 from）同样要解析到 foo。
 */
import { describe, it, expect } from "vitest";
import { resolveExportSource } from "../scan-call-graph.ts";

describe("re-export rename resolution", () => {
  it("export { foo as bar } from './other' hops with local name", () => {
    const other = `export function foo() { return 1; }\n`;
    const mid = `export { foo as bar } from "./other.js";\n`;
    const files: Record<string, string> = {
      "/m.js": mid,
      "/other.js": other,
    };
    const r = resolveExportSource(
      mid,
      "bar",
      (spec, from) => {
        const base = from.replace(/\/[^/]*$/, "/");
        const key = spec.startsWith(".") ? base + spec.replace(/^\.\//, "") : spec;
        return files[key];
      },
      0,
      "/m.js",
      "/m.js",
    );
    expect(r.source).toBe(other);
    expect(r.fromFile).toContain("other");
  });

  it("export { foo as bar } (local def) resolves to foo source", () => {
    const src = `export function foo() { return 1; }\nexport { foo as bar };\n`;
    const r = resolveExportSource(src, "bar", () => undefined);
    expect(r.source).toBe(src);
  });

  it("plain export function name still matches", () => {
    const src = `export function bar() { return 1; }\n`;
    const r = resolveExportSource(src, "bar", () => undefined);
    expect(r.source).toBe(src);
  });
});
