import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { formatCheckReport } from "../check-report.ts";

/**
 * any ≠ unknown：无约束入口上的 spread / 下标 / length 不得报引擎债。
 */
describe("any array/tuple faces (any ≠ unknown)", () => {
  const src = `
export function spreadAny(kinds) { return [...kinds]; }
export function idxAny(kinds) { return kinds[0]; }
export function lenAny(kinds) { return kinds.length; }
export function tern(kinds) { return kinds.length === 1 ? kinds[0] : "union"; }
export function objSpread(kinds) { return { kinds: [...kinds] }; }
export function unionVal(kinds, v) {
  return { kind: kinds.length === 1 ? kinds[0] : "union", kinds: [...kinds], v };
}
export function litTuple() { return { kinds: ["num", "str"] }; }
`;
  const r = checkSource("any-faces.js", src, pTrue, {});
  const sig = (n: string) => r.signatures.find((s) => s.name === n);

  it("no unknown-inference on any members", () => {
    const unk = r.issues.filter((i) => i.code === "nudo:unknown-inference");
    expect(unk.map((i) => i.message).join("; ") || "ok").toBe("ok");
  });

  it("[...any] → any[] (not unknown[])", () => {
    expect(sig("spreadAny")!.display).toContain("any[]");
    expect(sig("spreadAny")!.display).not.toContain("unknown");
  });

  it("any[i] / any.length → any", () => {
    expect(sig("idxAny")!.display).toMatch(/^any\b/);
    expect(sig("idxAny")!.display).not.toContain("unknown");
    expect(sig("lenAny")!.display).toMatch(/^any\b/);
    expect(sig("lenAny")!.display).not.toContain("unknown");
  });

  it("unionVal helper keeps any[] kinds face", () => {
    const d = sig("unionVal")!.display;
    expect(d).toContain("any[]");
    expect(d).not.toContain("unknown[]");
  });

  it("string-literal tuple stays exact", () => {
    expect(sig("litTuple")!.display).toContain('["num", "str"]');
  });

  it("slim report does not scream unknown on these", () => {
    const text = formatCheckReport(r);
    expect(text).not.toContain("nudo:unknown-inference");
  });
});
