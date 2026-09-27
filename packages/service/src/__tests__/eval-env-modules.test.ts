import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, clearEvalCache } from "@nudojs/service";
import { formatShape } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("evaluator env modules (node:path)", () => {
  it("path.join via import from node:path", () => {
    clearEvalCache();
    const source = `/// @nudo:env node

import { join } from "node:path";

/**
 * @nudo:case "test" ("src", "utils", "index.js")
 */
function buildPath(a, b, c) {
  return join(a, b, c);
}
`;
    const result = analyzeFile("/test/pathmod.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe('"src/utils/index.js"');
  });
});
