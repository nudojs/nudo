import { describe, it, expect } from "vitest";
import { harvestNodeTypes, summarizeNodeEnv } from "../harvest-node.ts";
import { resolve } from "node:path";

describe("harvest @types/node", () => {
  it("harvests @types/node when installed", () => {
    const root = resolve(process.cwd(), "../..");
    const r = harvestNodeTypes(root, 6);
    if (!r.ok) {
      // env may not have @types/node in some CI — soft skip
      expect(r.error).toBeTruthy();
      return;
    }
    expect(r.files).toBeGreaterThan(0);
    expect(r.env.stats.symbols).toBeGreaterThan(0);
    const s = summarizeNodeEnv(r.env);
    expect(s.symbolCount).toBeGreaterThan(0);
    // Node env 通常含 process / Buffer 等全局
    const hasUseful =
      s.globals.some((g) => /process|Buffer|console/i.test(g)) ||
      s.modules.length > 0;
    expect(hasUseful).toBe(true);
  });
});
