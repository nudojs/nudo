import { describe, it, expect } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

describe("@nudo:env declaration-only fnSig (readFileSync)", () => {
  it("utf8 encoding yields string, then .split[0] is string", () => {
    clearBPathCache();
    const source = `/// @nudo:env node
import { readFileSync } from "node:fs";
export function firstLine(p) { return readFileSync(p, "utf8").split("\\n")[0]; }
firstLine("/etc/hostname");
`;
    const result = analyzeFile("/tmp/nudo-env-firstline.js", source);
    const fn = result.functions.find((f) => f.name === "firstLine");
    expect(fn).toBeDefined();
    const call = fn!.cases.find((c) => c.name.startsWith("call@"));
    expect(call).toBeDefined();
    expect(typeValueToString(call!.result)).toBe("string");
    expect(result.diagnostics.some((d) => d.code === "nudo:unknown-recv")).toBe(false);
  });

  it("without @nudo:env the same file stays unknown", () => {
    clearBPathCache();
    const source = `import { readFileSync } from "node:fs";
export function firstLine(p) { return readFileSync(p, "utf8").split("\\n")[0]; }
firstLine("/etc/hostname");
`;
    const result = analyzeFile("/tmp/nudo-noenv-firstline.js", source);
    const fn = result.functions.find((f) => f.name === "firstLine");
    const call = fn?.cases.find((c) => c.name.startsWith("call@"));
    expect(call).toBeDefined();
    expect(typeValueToString(call!.result)).toBe("unknown");
  });
});
