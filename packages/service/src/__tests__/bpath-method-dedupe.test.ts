import { it, expect, describe } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function analyze(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bdedup-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "bdedup", version: "1.0.0" }));
  writeFileSync(join(dir, "index.js"), src);
  return analyzeFile(join(dir, "index.js"), src);
}

describe("B method-missing provenance + dedupe", () => {
  it("no-method is not double-reported when B and TypeValue both see the call", () => {
    // B case 执行 + evaluateProgram 顶层 const 调用都会碰到 toUpperCase 缺失；
    // 按名去重后只应剩一条。
    const src = `
/**
 * @nudo:case "n" (42)
 */
function demo(n) {
  return n.toUpperCase();
}

const boom = demo(42);
`;
    const r = analyze(src);
    const methodDiags = r.diagnostics.filter(
      (d) => d.code === "nudo:no-method" && d.message.includes("toUpperCase"),
    );
    expect(methodDiags.length).toBe(1);
  });

  it("TypeValue-only method diags are kept when B does not report the name", () => {
    const src = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const r = analyze(src);
    const diags = r.diagnostics.filter((d) => d.code === "nudo:no-method");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags.some((d) => d.message.includes("toUpperCase"))).toBe(true);
  });

  it("same name:line is reported at most once", () => {
    const src = `
/**
 * @nudo:case "null" (null)
 * @nudo:case "num" (1)
 */
function demo(o) {
  return o.foo;
}
`;
    const r = analyze(src);
    const fooDiags = r.diagnostics.filter(
      (d) => d.code === "nudo:no-method" && d.message.includes("'foo'"),
    );
    const keys = fooDiags.map((d) => `${d.range.start.line}:${d.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
