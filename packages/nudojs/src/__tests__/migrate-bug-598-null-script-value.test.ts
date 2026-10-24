/**
 * Bug 598 — `package.json` 的 `scripts` 值是 `null` 时 `migrate status` / `retire` 抛
 * 裸 TypeError（`Cannot read properties of null (reading 'split')`）——
 * 没有包名、没有文件路径、没有 `error:` / `fix:` 引导。
 * 根因：`as Record<string, string>` 只是编译期断言；`?? {}` 只兜「scripts 整个缺失」。
 *
 * 期望：非字符串的 script 值当作「无命令」（与 npm 语义一致）——不崩、不算 tsc。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as migrate from "../migrate.ts";

const { migrateStatus } = migrate;
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function nullScriptPkg() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-598-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "badscripts", version: "1.0.0", scripts: { typecheck: null } }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(a) { return a + 1; }\n", "utf-8");
  return dir;
}

describe("Bug 598: scripts 的值为 null 时 migrate status 不崩", () => {
  it("API 面不抛，null 脚本不算 tsc", () => {
    const dir = nullScriptPkg();
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tscScripts).toEqual([]);
    expect(rows[0]!.nudoScripts).toEqual([]);
  });

  it("CLI 面 exit 0 且不出现裸 TypeError", () => {
    const dir = nullScriptPkg();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("migrate status");
    expect(`${r.stdout}${r.stderr}`).not.toContain("Cannot read properties of null");
  });

  it("CLI --json 面也正常（exit 0 + 合法 JSON）", () => {
    const dir = nullScriptPkg();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ tscScripts: string[] }>;
    expect(parsed[0]!.tscScripts).toEqual([]);
  });

  it("反向闸：字符串脚本照常被识别（判定不是恒空）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-598-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ok", version: "1.0.0", scripts: { typecheck: "tsc --noEmit" } }),
      "utf-8",
    );
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual(["typecheck"]);
  });

  it("scriptCommandEntries 只收字符串值", () => {
    expect(
      migrate.scriptCommandEntries({ scripts: { a: "x", b: null, c: 3, d: "y" } }),
    ).toEqual([
      ["a", "x"],
      ["d", "y"],
    ]);
    expect(migrate.scriptCommandEntries({ scripts: null })).toEqual([]);
    expect(migrate.scriptCommandEntries(undefined)).toEqual([]);
  });
});
