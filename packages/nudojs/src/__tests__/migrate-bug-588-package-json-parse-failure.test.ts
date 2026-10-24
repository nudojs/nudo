/**
 * Bug 588 — `migrate status` **吞掉畸形的 package.json**（readJson 解析失败 ⇒ undefined，
 * 与「文件不存在」不可区分）⇒ 报「typescript dep: no」＋「tscScripts: []」（假绿）。
 * 同一份文件在 `nudo check` 面被明确报成「package.json parse failed」。
 *
 * 期望：status 必须区分「不存在」/「解析失败」——
 * 解析失败 ⇒ 显式报出（blockers + JSON 字段 packageJsonError），不得当成「没有」。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as migrate from "../migrate.ts";

const { migrateStatus, formatStatusTable } = migrate;
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function malformed() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  // 缺一个右花括号（JSON 语法错）
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "bad1", "scripts": { "typecheck": "tsc --noEmit" }, "devDependencies": { "typescript": "^5.0.0" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "src", "a.ts"), "export const a: number = 1;\n", "utf-8");
  return dir;
}

describe("Bug 588: migrate status 区分「package.json 不存在」与「解析失败」", () => {
  it("解析失败 ⇒ blockers 显式报出 + packageJsonError 字段", () => {
    const dir = malformed();
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.packageJson).toBe(true);
    expect(rows[0]!.packageJsonError).toBeDefined();
    expect(rows[0]!.packageJsonError).toContain("package.json parse failed");
    expect(rows[0]!.blockers).toContain("package.json parse failed");
  });

  it("文本面出现解析失败行", () => {
    const dir = malformed();
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("package.json parse failed");
  });

  it("JSON 面带 packageJsonError 且 stdout 是合法 JSON", () => {
    const dir = malformed();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(String(parsed[0]!.packageJsonError)).toContain("package.json parse failed");
    expect(parsed[0]!.blockers).toContain("package.json parse failed");
  });

  it("反向闸：合法 package.json ⇒ 无 packageJsonError、无该阻塞", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ok1", version: "1.0.0", devDependencies: { typescript: "^5.0.0" } }),
      "utf-8",
    );
    const rows = migrateStatus(dir);
    expect(rows[0]!.packageJsonError).toBeUndefined();
    expect(rows[0]!.blockers).not.toContain("package.json parse failed");
  });

  it("反向闸：package.json 不存在 ≠ 解析失败（missing 不算错误）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-missing-"));
    dirs.push(dir);
    const rows = migrateStatus(dir);
    expect(rows[0]!.packageJson).toBe(false);
    expect(rows[0]!.packageJsonError).toBeUndefined();
    expect(rows[0]!.blockers).not.toContain("package.json parse failed");
  });

  it("readPackageJsonDetailed 分类：missing / ok / invalid", () => {
    const dir = malformed();
    expect(migrate.readPackageJsonDetailed(join(dir, "package.json")).kind).toBe("invalid");
    expect(migrate.readPackageJsonDetailed(join(dir, "nope.json")).kind).toBe("missing");
    const ok = mkdtempSync(join(tmpdir(), "nudo-m2-588-ok2-"));
    dirs.push(ok);
    writeFileSync(join(ok, "package.json"), '{"name":"x"}', "utf-8");
    expect(migrate.readPackageJsonDetailed(join(ok, "package.json")).kind).toBe("ok");
  });
});
