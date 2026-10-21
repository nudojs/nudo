/**
 * Bug 671 — 目录目标的文件收集**静默跳过符号链接**。
 *
 * 旧实现用 `entry.isDirectory()` / `entry.isFile()` 判定 dirent ⇒ 符号链接
 * 条目两者皆 false（既非 dir 也非 file）⇒ 被**静默丢弃**（既不分析、也不报
 * 路径错误）⇒ `check <dir>` 对链接进来的坏文件**假绿**（exit 0），同一文件
 * 直传却 FAILED（exit 1）。
 *
 * 修法：`collectNudoFiles` 跟随符号链接判定（`statSync`），目录链接按
 * realpath 防环。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectNudoFiles } from "../commands/shared.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

/** L2 entry-may-throw：解引用 unconstrained 参数 */
const BAD_SRC = `export function getName(obj) {
  return obj.name;
}
`;
const GOOD_SRC = `export function one() {
  return 1;
}
`;

describe("Bug 671 — 目录扫描跟随符号链接", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：base/l2.js（坏）+ base/symdir/{good.js, badlink.js -> ../l2.js} */
  function makeFixture(): string {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-"));
    dirs.push(base);
    const scanDir = join(base, "symdir");
    mkdirSync(scanDir, { recursive: true });
    writeFileSync(join(base, "l2.js"), BAD_SRC, "utf-8");
    writeFileSync(join(scanDir, "good.js"), GOOD_SRC, "utf-8");
    symlinkSync(join(base, "l2.js"), join(scanDir, "badlink.js"));
    return scanDir;
  }

  it("collectNudoFiles 收进链接进来的 .js（改前：静默跳过）", () => {
    const scanDir = makeFixture();
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["badlink.js", "good.js"]);
  });

  it("符号链接目录被递归进入（改前：整棵链接目录被跳过）", () => {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-dir-"));
    dirs.push(base);
    const real = join(base, "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "inside.js"), GOOD_SRC, "utf-8");
    const scanDir = join(base, "scan");
    mkdirSync(scanDir, { recursive: true });
    symlinkSync(real, join(scanDir, "linked-dir"));
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["inside.js"]);
  });

  it("CLI check <dir>：链接进来的坏文件参与门禁（改前：exit 0 假绿）", () => {
    const scanDir = makeFixture();
    const r = runCliTsx(["check", scanDir]);
    expect(r.stdout).toContain("badlink.js");
    expect(r.status).toBe(1);
  });

  it("同一文件直传与目录扫描结论一致（不再一个绿一个红）", () => {
    const scanDir = makeFixture();
    const direct = runCliTsx(["check", join(scanDir, "badlink.js")]);
    const viaDir = runCliTsx(["check", scanDir]);
    expect(direct.status).toBe(1);
    expect(viaDir.status).toBe(direct.status);
    // 目录扫描必须**看见**同一个文件（改前：链接被静默跳过，目录面看不见它）
    expect(viaDir.stdout).toContain("badlink.js");
    expect(viaDir.stdout).toContain("nudo:entry-may-throw");
  });
});
