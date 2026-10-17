/**
 * check 侧车读取失败分类：ENOENT = 合法 miss（静默 absent）；
 * EACCES/EISDIR 等读失败必须上屏（warning），不得伪装成 miss——
 * 否则契约面静默丢失，check 可能假绿。
 * plain check（sidecarContent）与 --fix 面（sidecarText）同口径。
 * root 下 chmod 000 仍可读 → skip（同 check-fix-read-error.test.ts 口径）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

const SRC = "export function id(x) { return x; }\n";
const SIDECAR = "// @generated\nexport const id = fn({ x: any() }, any());\n";

describe.skipIf(isRoot)("check 侧车读失败上屏（不伪装 absent）", () => {
  it("plain check：EACCES 侧车 → warning 上屏 + 深层 interface-load 挡红", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sc-read-"));
    try {
      const file = join(dir, "f.js");
      writeFileSync(file, SRC, "utf-8");
      const sidecar = join(dir, "f.nudo.js");
      writeFileSync(sidecar, SIDECAR, "utf-8");
      chmodSync(sidecar, 0o000);
      const r = runCli(["check", file], { env: { NUDO_CACHE_DIR: join(dir, "cache") } });
      expect(r.stderr).toContain("warning: cannot read sidecar contract");
      expect(r.stderr).toContain(sidecar);
      // 深层分析器独立报 nudo:interface-load → 门禁不假绿
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toContain("nudo:interface-load");
    } finally {
      chmodSync(join(dir, "f.nudo.js"), 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--fix 面：EACCES 侧车 → 同 warning 上屏", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sc-fix-"));
    try {
      const file = join(dir, "f.js");
      writeFileSync(file, SRC, "utf-8");
      const sidecar = join(dir, "f.nudo.js");
      writeFileSync(sidecar, SIDECAR, "utf-8");
      chmodSync(sidecar, 0o000);
      const r = runCli(["check", "--fix", file], { env: { NUDO_CACHE_DIR: join(dir, "cache") } });
      expect(r.stderr).toContain("warning: cannot read sidecar contract");
      expect(r.stderr).toContain(sidecar);
    } finally {
      chmodSync(join(dir, "f.nudo.js"), 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对照：无侧车（真 miss ENOENT）→ 无 warning，绿", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sc-miss-"));
    try {
      const file = join(dir, "f.js");
      writeFileSync(file, SRC, "utf-8");
      const r = runCli(["check", file], { env: { NUDO_CACHE_DIR: join(dir, "cache") } });
      expect(r.stderr).not.toContain("cannot read sidecar");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
