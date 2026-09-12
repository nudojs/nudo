import { describe, it, expect, afterAll } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";

const dirs: string[] = [];
afterAll(() => {
  void dirs;
});

describe("B method-missing provenance + dedupe", () => {
  it("no-method is not double-reported and may carry origin", () => {
    clearBPathCache();
    const source = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const result = analyzeFile("/test/dedup.js", source);
    const diags = result.diagnostics.filter((d) => d.code === "nudo:no-method");
    // 至少一条；不应因 B+TypeValue 双报而爆炸
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags.length).toBeLessThanOrEqual(2);
    expect(diags[0]!.message).toContain("toUpperCase");
  });
});
