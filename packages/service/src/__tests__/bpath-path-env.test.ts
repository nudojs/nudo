import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFileAsync, clearBPathCache } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path path-based @nudo:env", () => {
  it("loads ./custom.env.ts globals", async () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-path-env-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "custom.env.ts"),
      `import { T } from "@nudojs/core";
export function defineEnv() {
  return {
    globals: {
      MAGIC: T.literal(99),
    },
  };
}
`,
    );
    const main = `/// @nudo:env ./custom.env.ts

/**
 * @nudo:case "t" ()
 */
function getMagic() {
  return MAGIC;
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const result = await analyzeFileAsync(p, main);
    const fn = result.functions.find((f) => f.name === "getMagic");
    expect(fn).toBeDefined();
    expect(typeValueToString(fn!.cases[0].result)).toBe("99");
  });
});
