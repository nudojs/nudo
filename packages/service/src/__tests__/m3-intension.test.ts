import { describe, it, expect, afterEach } from "vitest";
import { analyzeFile, setKernelModule } from "../index.ts";
import * as kernel from "@nudojs/kernel";

describe("M3 analyzer intension", () => {
  afterEach(() => {
    setKernelModule(null);
    delete process.env.NUDO_KERNEL;
  });

  it("default off: no intension", () => {
    delete process.env.NUDO_KERNEL;
    setKernelModule(null);
    const source = `function scale(x) { return x + 1; }\n`;
    const result = analyzeFile("f.js", source);
    const fn = result.functions.find((f) => f.name === "scale");
    expect(fn).toBeDefined();
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(entry!.intension).toBeUndefined();
  });

  it("NUDO_KERNEL=arith: entry@ gets intension display", () => {
    process.env.NUDO_KERNEL = "arith";
    setKernelModule(kernel);
    const source = `function scale(x) { return x + 1; }\n`;
    const result = analyzeFile("f.js", source);
    const fn = result.functions.find((f) => f.name === "scale");
    expect(fn).toBeDefined();
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(entry!.intension).toBeDefined();
    expect(entry!.intension!.display).toContain("scale");
    expect(entry!.intension!.display).toContain("+");
  });

  it("add generalizes to A1+A2", () => {
    process.env.NUDO_KERNEL = "all";
    setKernelModule(kernel);
    const source = `function add(a, b) { return a + b; }\n`;
    const result = analyzeFile("f.js", source);
    const fn = result.functions.find((f) => f.name === "add");
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry!.intension!.display).toContain("A1");
    expect(entry!.intension!.display).toContain("+");
  });
});
