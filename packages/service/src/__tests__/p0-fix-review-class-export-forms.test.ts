import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeFile } from "../analyzer.ts";

describe("P0 service class method collector export forms", () => {
  function fns(src: string) {
    const dir = mkdtempSync(join(tmpdir(), "nudo-class-"));
    const file = join(dir, "m.js");
    writeFileSync(file, src);
    const r = analyzeFile(file, src);
    return r.functions.map((f) => f.name).sort();
  }

  it("export class", () => {
    const names = fns(`
      export class Counter {
        inc() { return 1; }
        dec() { return 0; }
      }
    `);
    expect(names).toContain("Counter.inc");
    expect(names).toContain("Counter.dec");
  });

  it("class + export { C }", () => {
    const names = fns(`
      class Counter {
        inc() { return 1; }
      }
      export { Counter };
    `);
    expect(names).toContain("Counter.inc");
  });

  it("class + export default C", () => {
    const names = fns(`
      class Counter {
        inc() { return 1; }
      }
      export default Counter;
    `);
    expect(names).toContain("Counter.inc");
  });

  it("export { Local as Public } uses declaration name", () => {
    const names = fns(`
      class Local {
        run() { return 1; }
      }
      export { Local as Public };
    `);
    expect(names).toContain("Local.run");
  });
});
