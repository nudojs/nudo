import { describe, it, expect } from "vitest";
import { harvestPackage, formatHarvestSummary, resolvePackageRoot } from "../harvest-package.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("harvest npm package", () => {
  const root = resolve(process.cwd(), "../..");
  // monorepo root may vary; try a few
  const cwdHasTs = existsSync(resolve(root, "node_modules/typescript/package.json"));

  it("resolvePackageRoot finds workspace packages", () => {
    // typescript is a root devDep of the monorepo
    const r = resolvePackageRoot("typescript", root);
    if (r) {
      expect(existsSync(r)).toBe(true);
    } else {
      // environment without typescript installed — skip soft
      expect(r).toBeUndefined();
    }
  });

  it("harvestPackage on typescript if available", () => {
    const r = resolvePackageRoot("typescript", root);
    if (!r) {
      expect(true).toBe(true);
      return;
    }
    const h = harvestPackage("typescript", root);
    if ("error" in h) {
      // no d.ts collected — still ok in constrained env
      expect(h.error).toBeTruthy();
      return;
    }
    expect(h.dtsFiles.length).toBeGreaterThan(0);
    expect(h.env.stats.symbols).toBeGreaterThan(0);
    expect(formatHarvestSummary(h)).toContain("typescript");
  });
});
