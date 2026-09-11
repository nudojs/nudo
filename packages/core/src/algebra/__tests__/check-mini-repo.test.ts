import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const mini = (f: string) => readFileSync(resolve(root, "docs/examples/mini-repo", f), "utf8");

/**
 * mini-repo 人工金标：文件级 check 期望。
 * 这是「替换 tsc」的 recall 基线——新增违例模式时先补这里。
 */
describe("mini-repo check gold", () => {
  it("validators.js: no false positives", () => {
    const r = checkSource("validators.js", mini("validators.js"));
    expect(r.ok, r.issues.map((i) => i.message).join("; ")).toBe(true);
    expect(r.signatures.map((f) => f.name)).toContain("isPositive");
    expect(r.signatures.map((f) => f.name)).toContain("clamp");
  });

  it("store.js: class methods listed", () => {
    const r = checkSource("store.js", mini("store.js"));
    expect(r.ok).toBe(true);
  });

  it("user-service.js: ok (no literal violating calls)", () => {
    const r = checkSource("user-service.js", mini("user-service.js"));
    expect(r.ok, r.issues.map((i) => `${i.severity} ${i.message}`).join("; ")).toBe(true);
  });

  it("inline violating snippet still caught (TP recall)", () => {
    // isPositive 是谓词（无 if-return-param 前置）；真正门禁用 requires
    const src = `
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;
    const r = checkSource("tp.js", withStdImport(src), pTrue, stdOpts);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });
});
