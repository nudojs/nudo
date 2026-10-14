/**
 * defaultLoadModule 契约：无候选 → undefined；文件存在但读失败 → 抛
 * ModuleReadError（ENOENT 竞态按「无此文件」）。R2-6 #2 的 load-module 侧。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultLoadModule, ModuleReadError, resolveModuleFile } from "../load-module.ts";
import { tmpProject } from "./tmp-project.ts";

describe("defaultLoadModule distinguishes unreadable from missing (R2-6 #2)", () => {
  it("missing module → undefined（不抛）", () => {
    const dir = tmpProject("nudo-load-miss-");
    const from = join(dir, "main.js");
    writeFileSync(from, ``, "utf-8");
    expect(defaultLoadModule("./nope.js", from)).toBeUndefined();
  });

  it("existing but unreadable → throws ModuleReadError with code", () => {
    const dir = tmpProject("nudo-load-eacces-");
    const from = join(dir, "main.js");
    const dep = join(dir, "dep.js");
    writeFileSync(from, ``, "utf-8");
    writeFileSync(dep, `export const x = 1;\n`, "utf-8");
    chmodSync(dep, 0o000);
    try {
      expect(resolveModuleFile("./dep.js", from)).toBe(dep);
      let caught: unknown;
      try {
        defaultLoadModule("./dep.js", from);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ModuleReadError);
      expect((caught as ModuleReadError).code).toBe("EACCES");
      expect((caught as ModuleReadError).path).toBe(dep);
      expect((caught as ModuleReadError).message).toContain("cannot read module");
    } finally {
      chmodSync(dep, 0o644);
    }
  });

  it("directory candidate is skipped (resolveModuleFile), not a read error", () => {
    const dir = tmpProject("nudo-load-dir-");
    const from = join(dir, "main.js");
    writeFileSync(from, ``, "utf-8");
    mkdirSync(join(dir, "pkg"));
    expect(defaultLoadModule("./pkg", from)).toBeUndefined();
  });
});
