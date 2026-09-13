import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, tryBPathCall, isBPathCapable, clearBPathCache } from "@nudojs/service";
import { typeValueToString, $lit, absToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path @nudo:env", () => {
  it("isBPathCapable allows builtin and path env", () => {
    expect(isBPathCapable("function f() { return 1; }", ["es"])).toBe(true);
    expect(isBPathCapable("function f() { return 1; }", ["./custom.ts"])).toBe(true);
  });

  it("JSON.parse via @nudo:env es", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-env-"));
    dirs.push(dir);
    const main = `/// @nudo:env es

/**
 * @nudo:case "t" ("{}")
 */
export function parseId(s) {
  return typeof JSON.parse(s);
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const r = tryBPathCall(main, p, "parseId", [$lit("{}")], { envNames: ["es"] });
    expect(r).toBeDefined();
    expect(absToString(r!)).toContain("string");
  });

  it("analyzeFile works with @nudo:env es", () => {
    clearBPathCache();
    const source = `/// @nudo:env es

/**
 * @nudo:case "t" (5)
 */
function addOne(n) {
  return Math.floor(n) + 1;
}
`;
    const result = analyzeFile("/test/env.js", source);
    const fn = result.functions.find((f) => f.name === "addOne");
    expect(fn).toBeDefined();
    expect(typeValueToString(fn!.cases[0].result)).toBe("6");
  });

  it("arrowFn @nudo:mock injects into B-path (no real fetch call)", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-mock-b-"));
    dirs.push(dir);
    // 回归：arrowFn mock 落在 seedFns，此前 B 路径注入只吃 seedVars——
    // 函数体内的 fetch 调用落到真实原生 fetch，拿 Abs 当 URL 直接崩
    const source = `// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "ada" }) })
async function loadUser(id) {
  const res = await fetch("/users/" + id);
  return res.json();
}
loadUser(42);
`;
    const p = join(dir, "main.js");
    writeFileSync(p, source, "utf-8");
    const result = analyzeFile(p, source);
    const fn = result.functions.find((f) => f.name === "loadUser");
    expect(fn).toBeDefined();
    const call = fn!.cases.find((c) => c.name.startsWith("call@"));
    expect(call).toBeDefined();
    expect(call!.intension?.abs).toContain("ada");
    // mock 覆盖后 fetch 不再是 builtin-unknown
    expect(result.diagnostics.some((d) => d.code === "nudo:builtin-unknown")).toBe(false);
  });
});
