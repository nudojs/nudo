import { describe, it, expect } from "vitest";
import { testTool } from "../agent-tools.ts";

describe("nudo.test agent tool", () => {
  const src = `function scale(x) { return x + 1; }\n`;

  it("returns CaseJson v1 with abs intension", () => {
    const r = testTool(
      { file: "/t/scale.js", source: src, format: "json" },
      { readFile: () => src },
    );
    const json = JSON.parse(r.content[0].text);
    expect(json.version).toBe(1);
    expect(json.functions[0].name).toBe("scale");
    expect(json.functions[0].cases[0].intension.abs).toContain("#");
  });

  it("text format lists abs lines", () => {
    const r = testTool({ file: "/t/scale.js", source: src }, { readFile: () => src });
    const text = r.content[0].text;
    expect(text).toContain("scale");
    expect(text).toContain("abs:");
    expect(text).toContain('"version": 1');
  });

  it("filters by function name", () => {
    const multi = `
function a(x) { return x; }
function b(x) { return x + 1; }
`;
    const r = testTool(
      { file: "/t/m.js", source: multi, format: "json", functions: ["b"] },
      { readFile: () => multi },
    );
    const json = JSON.parse(r.content[0].text);
    expect(json.functions.map((f: { name: string }) => f.name)).toEqual(["b"]);
  });
});
