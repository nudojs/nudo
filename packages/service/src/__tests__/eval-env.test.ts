import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, tryEvalCall, clearEvalCache } from "@nudojs/service";
import { formatShape, $lit, absToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("evaluator @nudo:env", () => {
  it("JSON.parse via @nudo:env es", () => {
    clearEvalCache();
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
    const r = tryEvalCall(main, p, "parseId", [$lit("{}")], { envNames: ["es"] });
    expect(r).toBeDefined();
    expect(absToString(r!)).toContain("string");
  });

  it("analyzeFile works with @nudo:env es", () => {
    clearEvalCache();
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
    expect(formatShape(fn!.cases[0].abs)).toBe("6");
  });

  it("arrowFn @nudo:mock injects into evaluator (no real fetch call)", () => {
    clearEvalCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-mock-b-"));
    dirs.push(dir);
    // 回归：arrowFn mock 落在 seedFns，此前 求值引擎注入只吃 seedVars——
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

  // issue #58：nudo.env 遮蔽宿主全局后，Number(x) / new Array(n) 曾折 unknown。
  it("env-shadowed Number(x) and new Array(n) stay precise", () => {
    clearEvalCache();
    const source = `/// @nudo:env es

/**
 * @nudo:case "n" ("42")
 */
export function n1(s) { return Number(s); }

/**
 * @nudo:case "n" (3)
 */
export function n2(n) { return new Array(n).length; }

/**
 * @nudo:case "n" (1)
 */
export function n3(n) { return Array.isArray(new Array(n)); }

/**
 * @nudo:case "x" (1.5)
 */
export function n4(x) { return Number.isInteger(x); }
`;
    const r1 = tryEvalCall(source, "/test/issue58.js", "n1", [$lit("42")], {
      envNames: ["es"],
    });
    expect(formatShape(r1!)).toBe("42");

    const r2 = tryEvalCall(source, "/test/issue58.js", "n2", [$lit(3)], {
      envNames: ["es"],
    });
    expect(formatShape(r2!)).toBe("3");

    const r3 = tryEvalCall(source, "/test/issue58.js", "n3", [$lit(1)], {
      envNames: ["es"],
    });
    // new Array(1) 是 tuple → Array.isArray → true
    expect(formatShape(r3!)).toBe("true");

    const r4 = tryEvalCall(source, "/test/issue58.js", "n4", [$lit(1.5)], {
      envNames: ["es"],
    });
    expect(formatShape(r4!)).toBe("false");
  });
});
