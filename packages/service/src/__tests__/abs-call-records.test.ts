import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeFile } from "@nudojs/service";
import { formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

describe("Abs call records with relative import", () => {
  it("tags imported calls with targetModule and feeds externalFunctions", () => {
    const dir = tmpProject("nudo-abs-call-");
    const evalSrc = `export function triple(x) { return x * 3; }\n`;
    const aSrc = `import { triple } from "./b.js";\nfunction caller(n) { return triple(n); }\nconst r = caller(4);\n`;
    writeFileSync(join(dir, "b.js"), evalSrc);
    const aPath = resolve(dir, "a.js");
    writeFileSync(aPath, aSrc);

    const result = analyzeFile(aPath, aSrc);

    expect(result.externalFunctions).toBeDefined();
    expect(result.externalFunctions).toHaveLength(1);
    const triple = result.externalFunctions![0];
    expect(triple.name).toBe("triple");
    expect(triple.fromModule).toContain("b.js");
    expect(triple.cases).toHaveLength(1);
    expect(formatShape(triple.cases[0].abs)).toBe("12");
  });
});
