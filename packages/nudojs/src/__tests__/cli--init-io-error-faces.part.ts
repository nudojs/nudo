/**
 * Bug 680 — `nudo init` 的 IO 失败路径：**读失败被误报成「不是合法 JSON」**；
 * **写失败抛未捕获异常**（裸 errno、无 `error:` / `fix:` 引导）。
 *
 * 改前：readFileSync 与 JSON.parse 共用一个 catch ⇒ EACCES 也被报成
 * 「is not valid JSON」；writeFileSync 无 catch ⇒ 异常冒泡（stderr 只有一行
 * 裸 errno，没有 error:/fix: 引导）。
 * 改后：读失败 ⇒ 「cannot read …」；解析失败 ⇒ 「is not valid JSON …」；
 * 写失败 ⇒ 「cannot write …」+ `fix:` 引导；三条路径都 exit 1。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「cannot read」「cannot write」两条断言
 * **必红**（HEAD 报「is not valid JSON」/ 抛裸 errno）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../commands/init.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-680-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

/** root 跑起来时权限测试无意义（root 无视 chmod） */
const canTestPermissions = typeof process.getuid !== "function" || process.getuid() !== 0;

describe("Bug 680 — init 的 IO 失败路径可区分", () => {
  it("package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1", () => {
    if (!canTestPermissions) return;
    const dir = pkgDir('{ "name": "noread" }\n');
    const pkgPath = join(dir, "package.json");
    chmodSync(pkgPath, 0o000);
    const errors: string[] = [];
    let code = 0;
    try {
      code = runInit(dir, { out: () => {}, err: (l) => errors.push(l) });
    } finally {
      chmodSync(pkgPath, 0o644);
    }
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("error: cannot read");
    expect(errors.join("\n")).not.toContain("is not valid JSON");
    expect(errors.join("\n")).toContain("fix:");
  });

  it("package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）", () => {
    if (!canTestPermissions) return;
    const dir = pkgDir('{ "name": "ro" }\n');
    const pkgPath = join(dir, "package.json");
    chmodSync(pkgPath, 0o444);
    const errors: string[] = [];
    let code = 0;
    try {
      code = runInit(dir, { out: () => {}, err: (l) => errors.push(l) });
    } finally {
      chmodSync(pkgPath, 0o644);
    }
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("error: cannot write");
    expect(errors.join("\n")).toContain("fix:");
    // 文件内容未被改动
    expect(readFileSync(pkgPath, "utf-8")).toBe('{ "name": "ro" }\n');
  });

  it("真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）", () => {
    const dir = pkgDir('{ "name": "badjson", }\n');
    const errors: string[] = [];
    expect(runInit(dir, { out: () => {}, err: (l) => errors.push(l) })).toBe(1);
    expect(errors.join("\n")).toContain("is not valid JSON — nothing written");
    expect(errors.join("\n")).toContain("fix:  repair it first (parse error:");
    expect(errors.join("\n")).not.toContain("cannot read");
  });
});
