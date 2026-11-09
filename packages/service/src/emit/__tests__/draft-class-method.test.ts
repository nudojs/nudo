import {describe, it, expect} from "vitest";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {draftContract, collectParamBodyAccesses} from "../contract-draft.ts";
import {transpileSource} from "@nudojs/core";

describe("Draft Class.method + continue-path", () => {
  it("drafts Class.method as Class_method export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-draft-cls-"));
    try {
      const file = join(dir, "cls.js");
      writeFileSync(
        file,
        `export class Counter {
  inc(n) { return n + 1; }
}
`,
      );
      const r = await draftContract(file);
      const entry = r.entries.find((e) => e.fn === "Counter.inc");
      expect(entry).toBeDefined();
      expect(r.draftSource).toContain("export const Counter_inc = ");
      expect(r.draftSource).not.toContain("export const Counter.inc = ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collectParamBodyAccesses walks class methods", () => {
    const map = collectParamBodyAccesses(`export class U {
  greet(user) { return user.name; }
}
`);
    expect(map.has("U.greet")).toBe(true);
  });

  it("transpile still emits rest destructure after restore", () => {
    expect(transpileSource(`function f(o){ const {a,...r}=o; return r; }`)).toContain("$objRest");
  });
});
