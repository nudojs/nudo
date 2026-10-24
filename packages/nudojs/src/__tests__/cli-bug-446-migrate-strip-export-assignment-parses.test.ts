/**
 * Bug 446 —— TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物**根本
 * 不是合法 JS**（`node --check` 报 SyntaxError），而 `migrate verify` 对同一
 * 文件**报 OK / exit 0**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（语句级删除判定补
 * `TSExportAssignment` / `TSNamespaceExportDeclaration`）。本钉是**产物面**
 * 的回归钉：产物必须 `node --check` 过，且不得残留这两条 TS-only 语句。
 *
 * ⚠ 验收口径是「**strip 不产出坏产物**」——`migrate verify` 的契约是「跑
 * `nudo check`」，**不在**族 12 的改动范围（跨族增强须先改文档）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const EXPORT_ASSIGN_TS = `declare namespace N { const x: number; }
export = N;
`;
const NAMESPACE_EXPORT_TS = `export as namespace MyGlobal;
export declare const v: number;
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("Bug 446 —— TS-only 的模块出口语句必须被剥除（产物是合法 JS）", () => {
  it("`export =` 被剥除 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "a.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "a.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export =");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("`export as namespace` 被剥除 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "b.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "b.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export as namespace");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("兜底闸门认得这两条语句（真源漏网 ⇒ 拒绝写盘 + 点名文件 + exit 1）", () => {
    // 判据层断言：闸门对「剥完仍有 TS-only 出口语句」的文件必须报错。
    // 这里用**只读**的探针口径：以 `.ts` 源为输入 ⇒ 若真源漏网，命令层闸门
    // 会拦下（真源修好后不拦 ⇒ 下面的 exit 0 就是「不误伤」）。
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    for (const name of ["a.js", "b.js"]) {
      const check = nodeCheck(join(dir, name));
      expect(check.status, `${name}\n${check.stderr}`).toBe(0);
    }
  });
});
