import { describe, it, expect } from "vitest";
import { analyzeFile, serializeCaseJson } from "../index.ts";

describe("CaseJson contract v1", () => {
  it("self-contained function has abs in intension", () => {
    const src = `function scale(x) { return x + 1; }\n`;
    const result = analyzeFile("/t/scale.js", src);
    const json = serializeCaseJson(result, "/t/scale.js");
    expect(json.version).toBe(1);
    expect(json.file).toBe("/t/scale.js");
    expect(json.summary.functions).toBeGreaterThan(0);
    const fn = json.functions.find((f) => f.name === "scale");
    expect(fn).toBeDefined();
    expect(fn!.entryOnly).toBe(true);
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(entry!.intension?.abs).toContain("#");
    expect(entry!.intension?.display).toContain("scale");
    // 外延仍有 TypeValue 字符串
    expect(typeof entry!.result).toBe("string");
  });

  it("call site cases include args/result strings", () => {
    const src = `
function add(a, b) { return a + b; }
const r = add(2, 3);
`;
    const result = analyzeFile("/t/add.js", src);
    const json = serializeCaseJson(result, "/t/add.js");
    const add = json.functions.find((f) => f.name === "add");
    expect(add!.cases.length).toBeGreaterThan(0);
    expect(add!.cases[0]!.args.length).toBe(2);
    expect(add!.cases[0]!.result).toBe("5");
  });
});
