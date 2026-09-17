import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { formatShape } from "@nudojs/core";

describe("self-contained Abs call records", () => {
  it("collects call sites from Abs program eval", () => {
    const source = `
      function add(a, b) { return a + b; }
      const r = add(2, 3);
    `;
    const result = analyzeFile("/t/abs-call.js", source);
    const add = result.functions.find((f) => f.name === "add");
    expect(add).toBeDefined();
    expect(add!.cases.length).toBeGreaterThan(0);
    expect(add!.cases[0]!.source).toBe("callsite");
    expect(formatShape(add!.cases[0]!.abs)).toBe("5");
  });

  it("self-contained entry still works", () => {
    const source = `function scale(x) { return x + 1; }`;
    const result = analyzeFile("/t/abs-entry.js", source);
    const scale = result.functions.find((f) => f.name === "scale");
    expect(scale!.entryOnly).toBe(true);
    expect(scale!.cases[0]!.intension).toBeDefined();
  });

  it("mock seeds feed Abs path (call@ stays exact)", () => {
    const source = `
      // @nudo:mock parse = stub().returns(42)
      function run() {
        return parse();
      }
      const r = run();
    `;
    const result = analyzeFile("/t/abs-mock.js", source);
    const run = result.functions.find((f) => f.name === "run");
    expect(run).toBeDefined();
    const call = run!.cases.find((c) => c.source === "callsite");
    expect(call).toBeDefined();
    expect(formatShape(call!.abs)).toBe("42");
  });

  it("directive expected is carried on CaseResult", () => {
    const source = `
      /**
       * @nudo:case "ok" (1) => T.number
       * @nudo:case "bad" (1) => T.string
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/abs-expected.js", source);
    const id = result.functions.find((f) => f.name === "id");
    const ok = id!.cases.find((c) => c.name === "ok");
    const bad = id!.cases.find((c) => c.name === "bad");
    expect(ok!.expected).toBeDefined();
    expect(bad!.expected).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === "nudo:case-expected")).toBe(true);
  });
});
