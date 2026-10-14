import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeFileAsync, clearEvalCache } from "@nudojs/service";
import { formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

describe("evaluator path-based @nudo:env", () => {
  it("loads ./custom.env.ts globals", async () => {
    clearEvalCache();
    const dir = tmpProject("nudo-path-env-");
    writeFileSync(
      join(dir, "custom.env.ts"),
      `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return {
    globals: {
      MAGIC: numLit(99),
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
    expect(formatShape(fn!.cases[0].abs)).toBe("99");
  });
});
