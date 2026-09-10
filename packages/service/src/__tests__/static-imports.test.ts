import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectStaticImports } from "../static-imports.ts";

describe("host static imports (not a bundler)", () => {
  it("collects relative imports for type facts", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-imp-"));
    try {
      writeFileSync(
        join(dir, "math.js"),
        `export function add(a, b) { return a + b; }\nexport function scale(x) { return add(x, 1); }\n`,
      );
      writeFileSync(
        join(dir, "index.js"),
        `import { add, scale } from "./math.js";\nexport function double(x) { return scale(x) + x; }\n`,
      );
      const graph = collectStaticImports(join(dir, "index.js"));
      expect(graph.size).toBe(2);
      const index = graph.get(join(dir, "index.js"))!;
      expect(index.named.has("double")).toBe(true);
      expect(index.poly.get("double")?.display).toContain("double");
      const math = graph.get(join(dir, "math.js"))!;
      expect(math.poly.get("add")?.display).toContain("A1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips bare specifiers (npm packages)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bare-"));
    try {
      writeFileSync(
        join(dir, "app.js"),
        `import lodash from "lodash";\nexport function f(x) { return x + 1; }\n`,
      );
      const graph = collectStaticImports(join(dir, "app.js"));
      expect(graph.size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
