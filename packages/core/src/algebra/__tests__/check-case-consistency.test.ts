/**
 * case ⊄ refine → nudo:case-inconsistency
 * case 是契约的见证，不是另一套前置来源。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/case.js", withStdImport(src), pTrue, stdOpts);
}

describe("case vs refine", () => {
  it("ok: case 实参满足契约", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:case "ok" (5)
 */
function needsPositive(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });

  it("error: case 实参 ⊭ refine", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
function needsPositive(x) {
  return x;
}
`);
    const err = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
    expect(err!.expected).toContain(">");
    expect(err!.message).toContain("neg");
  });

  it("error: percent 上界违例", () => {
    const r = issuesOf(`
/**
 * @nudo:contract n percent
 * @nudo:case "big" (150)
 */
function pct(n) {
  return n;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:case-inconsistency")).toBe(true);
  });

  it("ok: 无 refine 的 case 不报", () => {
    const r = issuesOf(`
/**
 * @nudo:case "any" (-1)
 */
function id(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });
});
