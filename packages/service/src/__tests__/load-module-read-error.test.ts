/**
 * defaultLoadModule 契约：无候选 → undefined；文件存在但读失败 → 抛
 * ModuleReadError（ENOENT 竞态按「无此文件」）。R2-6 #2 的 load-module 侧。
 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultLoadModule, ModuleReadError, resolveModuleFile, safeLoadModule } from "../load-module.ts";
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

describe("safeLoadModule: 容错但可观测（读失败不静默）", () => {
  const eacces = (p: string) =>
    new ModuleReadError(p, Object.assign(new Error(`EACCES: permission denied, stat '${p}'`), { code: "EACCES" }));

  it("EACCES ModuleReadError → undefined + 按路径一次性 console.error 告警", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dep = "/nudo-safe-eacces/dep.js";
    const load = (): string | undefined => {
      throw eacces(dep);
    };
    try {
      expect(safeLoadModule(load, "./dep.js", "/nudo-safe-eacces/main.js")).toBeUndefined();
      expect(safeLoadModule(load, "./dep.js", "/nudo-safe-eacces/main.js")).toBeUndefined();
      expect(safeLoadModule(load, "./dep.js", "/nudo-safe-eacces/main.js")).toBeUndefined();
      // 同路径只告警一次（不刷屏），且告警带路径与 errno
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).toContain(dep);
      expect(String(errSpy.mock.calls[0]?.[0])).toContain("EACCES");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("ENOENT 与无 errno 的抛错 → 安静 undefined（miss 语义不告警）", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const enoent = new ModuleReadError(
      "/nudo-safe-enoent/gone.js",
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );
    try {
      expect(
        safeLoadModule(() => {
          throw enoent;
        }, "./gone.js", "/t/main.js"),
      ).toBeUndefined();
      expect(
        safeLoadModule(() => {
          throw new Error("custom loader blew up");
        }, "./dep.js", "/t/main.js"),
      ).toBeUndefined();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("正常 load 透传结果", () => {
    expect(safeLoadModule(() => "export const x = 1;", "./dep.js", "/t/main.js")).toBe(
      "export const x = 1;",
    );
  });
});
