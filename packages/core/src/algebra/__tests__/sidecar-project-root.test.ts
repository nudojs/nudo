/**
 * T7：项目根 ambient 绑定边界。
 * projectDir 提供时，树外侧车不 ambient 加载；树内正常；node_modules 仍拦。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSource,
  pTrue,
  effectiveInterface,
  sidecarClosureFingerprint,
} from "../index.ts";

const SIDE = `import { fn, number } from "@nudojs/core";
export const add = fn({ x: number(), y: number() }, number());
`;

function loadSibling(sideName: string) {
  return (spec: string, fromFile: string): string | undefined => {
    if (spec.includes(sideName) || spec.endsWith(".nudo.js")) return SIDE;
    void fromFile;
    return undefined;
  };
}

describe("projectDir ambient bind boundary", () => {
  it("in-tree sidecar binds when projectDir set", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-projroot-"));
    try {
      const srcPath = join(dir, "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      writeFileSync(join(dir, "lib.nudo.js"), SIDE);
      const eff = effectiveInterface(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: dir,
      });
      expect(eff).toBeDefined();
      expect(eff!.source).toBe("handwritten");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("out-of-tree sidecar is not ambient-bound when projectDir set", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-projroot-out-"));
    const outside = mkdtempSync(join(tmpdir(), "nudo-outside-"));
    try {
      const srcPath = join(outside, "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      writeFileSync(join(outside, "lib.nudo.js"), SIDE);
      const eff = effectiveInterface(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: root,
      });
      expect(eff?.source !== "handwritten").toBe(true);

      const fp = sidecarClosureFingerprint(srcPath, {
        loadModule: loadSibling("lib.nudo.js"),
        autoBind: true,
        projectDir: root,
      });
      expect(fp).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("node_modules sidecar stays blocked even inside projectDir", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-projroot-nm-"));
    try {
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      const srcPath = join(dir, "node_modules", "pkg", "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      const eff = effectiveInterface(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: dir,
      });
      expect(eff?.source !== "handwritten").toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkSource with projectDir does not load out-of-tree sidecar", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-projroot-chk-"));
    const outside = mkdtempSync(join(tmpdir(), "nudo-outside-chk-"));
    try {
      const srcPath = join(outside, "lib.js");
      const src = `export function add(x, y) { return x + y; }\nadd(1, -2);\n`;
      writeFileSync(srcPath, src);
      const load = (spec: string): string | undefined => {
        if (spec.endsWith(".nudo.js")) {
          return `import { fn, number } from "@nudojs/core";
export const add = fn({ x: number(), y: number().gt(0) }, number());
`;
        }
        return undefined;
      };
      const rOut = checkSource(srcPath, src, pTrue, {
        fromFile: srcPath,
        loadModule: load,
        autoBind: true,
        projectDir: root,
      });
      expect(
        rOut.issues.filter((i) => i.code === "nudo:constraint-violated"),
      ).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
