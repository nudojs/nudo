/**
 * resolveModuleFile 的 fs 错误分类（#135）：单次 statSync 替代
 * existsSync+statSync——「路径不存在」类（ENOENT / ENOTDIR / EISDIR）按
 * miss 继续；真实读故障（EACCES 等）抛 ModuleReadError，不得折叠成
 * 「无此文件」（否则瞬态故障被上游缓存钉死，契约族诊断静默消失）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLoadModule, ModuleReadError, resolveModuleFile } from "../load-module.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** root 对 chmod 000 免疫，真实 EACCES 用例无法生效 */
const isRoot = process.geteuid?.() === 0;

function freshDir(prefix: string): { dir: string; from: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  const from = join(dir, "main.js");
  writeFileSync(from, ``, "utf-8");
  return { dir, from };
}

describe("resolveModuleFile fs error taxonomy (#135)", () => {
  it("ENOTDIR（候选穿过文件段）→ miss 不抛", () => {
    const { dir, from } = freshDir("nudo-fs-enotdir-");
    // dep.js 是文件：候选表 dep.js/index.js 及其扩展全部穿过文件段 → ENOTDIR
    writeFileSync(join(dir, "dep.js"), `export const x = 1;\n`, "utf-8");
    expect(resolveModuleFile("./dep.js/index.js", from)).toBeUndefined();
    expect(defaultLoadModule("./dep.js/index.js", from)).toBeUndefined();
  });

  it("目录候选 → miss（跳过继续），index 入口仍可命中", () => {
    const { dir, from } = freshDir("nudo-fs-dir-");
    mkdirSync(join(dir, "pkg"));
    // pkg 本身是目录：跳过，其余候选 ENOENT → miss
    expect(resolveModuleFile("./pkg", from)).toBeUndefined();
    // pkg2/ 带真实 index 入口：目录候选跳过后 index 候选命中
    mkdirSync(join(dir, "pkg2"));
    writeFileSync(join(dir, "pkg2", "index.js"), `export const y = 2;\n`, "utf-8");
    expect(resolveModuleFile("./pkg2", from)).toBe(join(dir, "pkg2", "index.js"));
  });

  it("ENOENT → undefined（既有 miss 语义钉住）", () => {
    const { from } = freshDir("nudo-fs-enoent-");
    expect(resolveModuleFile("./nope.js", from)).toBeUndefined();
    expect(defaultLoadModule("./nope.js", from)).toBeUndefined();
  });

  it.runIf(!isRoot)("stat 级 EACCES（父目录 000）→ resolveModuleFile 抛 ModuleReadError", () => {
    const { dir, from } = freshDir("nudo-fs-stat-eacces-");
    mkdirSync(join(dir, "locked"));
    const dep = join(dir, "locked", "dep.js");
    writeFileSync(dep, `export const x = 1;\n`, "utf-8");
    chmodSync(join(dir, "locked"), 0o000);
    try {
      let caught: unknown;
      try {
        resolveModuleFile("./locked/dep.js", from);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ModuleReadError);
      expect((caught as ModuleReadError).code).toBe("EACCES");
      expect((caught as ModuleReadError).path).toBe(dep);
      // defaultLoadModule 同口径上抛（不得折叠成 undefined）
      expect(() => defaultLoadModule("./locked/dep.js", from)).toThrowError(ModuleReadError);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });

  it.runIf(!isRoot)("文件 000：stat 仍可解析（stat 无需读权限），readFileSync 抛 → defaultLoadModule 抛", () => {
    const { dir, from } = freshDir("nudo-fs-read-eacces-");
    const dep = join(dir, "dep.js");
    writeFileSync(dep, `export const x = 1;\n`, "utf-8");
    chmodSync(dep, 0o000);
    try {
      // stat 只要父目录可搜索即可成功：解析命中，读失败上抛
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
    } finally {
      chmodSync(dep, 0o644);
    }
  });
});
