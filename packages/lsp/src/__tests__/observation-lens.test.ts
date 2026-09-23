/**
 * 合成 call@ / entry@ 观察 CodeLens：CLI `nudo test` 的源码内投影。
 */
import { describe, it, expect } from "vitest";
import { computeObservationLenses } from "../agent-tools.ts";

const SRC = `export function add(a, b) {
  return a + b;
}

function use() {
  return add(1, 2);
}

export function uncalled(x) {
  return x;
}

use();
`;

describe("computeObservationLenses", () => {
  it("pins call@ at the call-site line with (args) => result title", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    const calls = lenses.filter((l) => l.kind === "callsite");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const addCall = calls.find((l) => l.fn === "add" && l.caseName.startsWith("call@"));
    expect(addCall).toBeDefined();
    // use() body call is on line 6: return add(1, 2);
    expect(addCall!.line).toBe(6);
    expect(addCall!.title).toMatch(/call@L6/);
    expect(addCall!.title).toContain("(1, 2)");
    expect(addCall!.title).toContain("=>");
  });

  it("pins entry@ on the function declaration line", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    const entries = lenses.filter((l) => l.kind === "entry");
    // uncalled export gets entry@
    const uncalled = entries.find((l) => l.fn === "uncalled");
    expect(uncalled).toBeDefined();
    expect(uncalled!.line).toBe(9);
    expect(uncalled!.title).toContain("entry@");
  });

  it("skips directive cases (those stay on case lens layer)", () => {
    const src = `/**
 * @nudo:case "num" (42)
 */
export function id(x) {
  return x;
}
`;
    const lenses = computeObservationLenses(src, "/t/dir.js");
    // directive case only → no observation lens for "num"
    expect(lenses.filter((l) => l.caseName === "num")).toEqual([]);
  });

  it("sorts by line and stays empty on unparseable noise without throwing", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    for (let i = 1; i < lenses.length; i++) {
      expect(lenses[i]!.line).toBeGreaterThanOrEqual(lenses[i - 1]!.line);
    }
    expect(() => computeObservationLenses("export function f(){ return 1 }", "/t/ok.js")).not.toThrow();
  });
});
