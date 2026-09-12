import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyzeFile } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Abs call records with relative import", () => {
  it("tags imported calls with targetModule and feeds externalFunctions", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-abs-call-"));
    dirs.push(dir);
    const bSrc = `export function triple(x) { return x * 3; }\n`;
    const aSrc = `import { triple } from "./b.js";\nfunction caller(n) { return triple(n); }\nconst r = caller(4);\n`;
    writeFileSync(join(dir, "b.js"), bSrc);
    const aPath = resolve(dir, "a.js");
    writeFileSync(aPath, aSrc);

    const result = analyzeFile(aPath, aSrc);

    expect(result.externalFunctions).toBeDefined();
    expect(result.externalFunctions).toHaveLength(1);
    const triple = result.externalFunctions![0];
    expect(triple.name).toBe("triple");
    expect(triple.fromModule).toContain("b.js");
    expect(triple.cases).toHaveLength(1);
    expect(typeValueToString(triple.cases[0].result)).toBe("12");
  });
});
