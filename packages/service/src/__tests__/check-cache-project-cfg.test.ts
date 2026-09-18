import { describe, it, expect } from "vitest";
import { checkCacheKey } from "../disk-cache.ts";

describe("checkCacheKey project config dimensions", () => {
  const src = "export function f() { return 1; }\n";
  const base = { autoBind: true, projectDir: "/p" as const };

  it("project env name list flips the key", () => {
    const a = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: [] });
    const b = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: ["es"] });
    const c = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: ["es", "node"] });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it("analysis knobs flip the key", () => {
    const a = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3 },
    });
    const b = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "all", evalMissingSlot: "off", callSiteBudget: 3 },
    });
    const c = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "warning", callSiteBudget: 3 },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
