import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeFile, clearEvalCache, tryEvalCallFull } from "@nudojs/service";
import { $lit } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

describe("evaluator method-missing diagnostics", () => {
  it("records no-method on number receiver via B execution", () => {
    clearEvalCache();
    const dir = tmpProject("nudo-md-");
    const src = `
export function badNum(n) {
  return n.toUpperCase();
}
`;
    const p = join(dir, "m.js");
    writeFileSync(p, src, "utf-8");
    const full = tryEvalCallFull(src, p, "badNum", [$lit(42)]);
    expect(full).toBeDefined();
    expect(full!.memberDiags?.length).toBeGreaterThanOrEqual(1);
    expect(full!.memberDiags![0]!.name).toBe("toUpperCase");
    expect(full!.memberDiags![0]!.receiver).toBe("number");
  });

  it("analyzeFile still reports no-method for top-level call", () => {
    clearEvalCache();
    const source = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const result = analyzeFile("/test/badnum2.js", source);
    const diags = result.diagnostics.filter((d) => d.code === "nudo:no-method");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0]!.message).toContain("toUpperCase");
  });
});
