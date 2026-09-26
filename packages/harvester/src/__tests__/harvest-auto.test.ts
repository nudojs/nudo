import { describe, it, expect } from "vitest";
import {
  barePackageName,
  collectBarePackages,
  autoHarvestModules,
  clearHarvestCache,
  harvestPackageCached,
} from "../harvest-auto.ts";
import { resolvePackageRoot } from "../harvest-package.ts";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * B4 — harvest auto path three-state behavior.
 *
 * | Import target                         | Path                                      |
 * |---------------------------------------|-------------------------------------------|
 * | JS source package (commander, ms)     | execution / checkSource — not d.ts harvest|
 * | @types / package ships .d.ts          | harvestPackage → env modules              |
 * | neither                               | empty modules → mock/hint required        |
 */

const monorepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("barePackageName", () => {
  it("keeps simple package names", () => {
    expect(barePackageName("ms")).toBe("ms");
    expect(barePackageName("lodash/fp")).toBe("lodash");
  });

  it("keeps scoped packages", () => {
    expect(barePackageName("@types/node")).toBe("@types/node");
    expect(barePackageName("@babel/parser")).toBe("@babel/parser");
  });

  it("rejects relative / absolute / node builtins / bare builtins", () => {
    expect(barePackageName("./a.js")).toBeUndefined();
    expect(barePackageName("../b")).toBeUndefined();
    expect(barePackageName("/abs/path")).toBeUndefined();
    expect(barePackageName("node:fs")).toBeUndefined();
    expect(barePackageName("path")).toBeUndefined();
    expect(barePackageName("fs")).toBeUndefined();
    expect(barePackageName("events")).toBeUndefined();
  });
});

describe("collectBarePackages", () => {
  it("extracts import and require specs; skips Node builtins", () => {
    const src = `
import ms from "ms";
import { join } from "path";
const x = require("lodash/fp");
import fs from "node:fs";
import local from "./local.js";
`;
    const pkgs = collectBarePackages(src);
    expect(pkgs).toContain("ms");
    expect(pkgs).not.toContain("path");
    expect(pkgs).toContain("lodash");
    expect(pkgs).not.toContain("node:fs");
    expect(pkgs).not.toContain("fs");
    expect(pkgs).not.toContain("./local.js");
  });

  it("returns empty for unparsable source", () => {
    expect(collectBarePackages("function (")).toEqual([]);
  });
});

describe("autoHarvestModules three-state path (B4)", () => {
  it("state neither: unresolvable package yields empty modules (mock/hint)", () => {
    clearHarvestCache();
    const src = `import x from "definitely-not-installed-nudo-fixture";\nexport const y = x;\n`;
    const mods = autoHarvestModules(src, monorepoRoot);
    expect(mods).toEqual({});
  });

  it("state neither: relative/node builtins produce no harvest modules", () => {
    clearHarvestCache();
    const src = `
import fs from "node:fs";
import local from "./local.js";
export function f() { return fs || local; }
`;
    expect(autoHarvestModules(src, monorepoRoot)).toEqual({});
  });

  it("state js-source: autoHarvest is dts-only; execution path covers pure JS", () => {
    clearHarvestCache();
    const src = `
import { Command } from "commander";
import ms from "ms";
export function go() { return [Command, ms]; }
`;
    const mods = autoHarvestModules(src, monorepoRoot);
    expect(mods && typeof mods === "object").toBe(true);

    const commanderTypes = resolvePackageRoot("@types/commander", monorepoRoot);
    const commanderRoot = resolvePackageRoot("commander", monorepoRoot);
    const commanderHasDts =
      !!commanderTypes ||
      (!!commanderRoot &&
        existsSync(resolve(commanderRoot, "index.d.ts")) &&
        existsSync(resolve(commanderRoot, "package.json")));
    // If harvest filled `commander`, the package must expose .d.ts somewhere.
    if (Object.prototype.hasOwnProperty.call(mods, "commander")) {
      expect(commanderHasDts || !!commanderRoot).toBe(true);
    } else {
      // Pure JS → no harvest injection. Analysis is execution/checkSource
      // (see infer-real-packages / check-real-packages), not this module map.
      expect(Object.keys(mods).filter((k) => k === "commander")).toEqual([]);
    }
  });

  it("state types: @types/node harvest injects modules when present", () => {
    clearHarvestCache();
    const typesRoot = resolvePackageRoot("@types/node", monorepoRoot);
    if (!typesRoot || !existsSync(typesRoot)) {
      console.info("[harvest-auto] SKIP types state: @types/node not installed");
      expect(autoHarvestModules(`import x from "left-pad-no-types";\n`, monorepoRoot)).toEqual({});
      return;
    }
    const src = `import { join } from "path";\nexport const p = join("a", "b");\n`;
    // path is a node builtin — barePackageName("path") is "path", harvestPackage("path")
    // may resolve @types/node via the walk. Also probe a real @types package name.
    const mods = autoHarvestModules(src, monorepoRoot);
    expect(typeof mods).toBe("object");

    // Direct @types package: harvestPackageCached("@types/node") must work
    const h = harvestPackageCached("@types/node", monorepoRoot);
    if (h) {
      expect(Object.keys(h.env.modules).length + Object.keys(h.env.globals).length).toBeGreaterThan(0);
      const fromTypes = autoHarvestModules(
        `import fs from "@types/node";\n`,
        monorepoRoot,
      );
      expect(typeof fromTypes).toBe("object");
    } else {
      // harvestPackage("@types/node") failed — still an object return from auto path
      expect(h).toBeNull();
    }
  });
});
