/**
 * BUG-065 —— `nudo migrate retire` 遇到**损坏的** `.nudo/migrate-retired.json`
 * ⇒ 静默丢弃并覆盖审计记录（exit 0）。
 *
 * 根因：`readJson` 把「文件不存在」与「JSON 解析失败」压成同一个 `undefined`
 * ⇒ `readMarkerRecords(undefined)` 返回空记录 ⇒ 旧审计（`retiredAt` /
 * `removedDeps` / `rewrittenScripts`）被覆盖成空。
 *
 * 期望（与 `package.json` 同款策略）：`invalid` / `unreadable` ⇒ **fail-closed
 * 报错**、不覆盖原文件。
 *
 * 反向闸：标记**不存在**时照常退役（「没有既有记录」不是错误）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-065-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b065",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

const BROKEN = '{ "retiredAt": "2020-01-01T00:00:00.000Z", "removedDeps": ["dependencies"], ';

describe("Bug 065: 损坏的审计标记必须 fail-closed（不得静默覆盖）", () => {
  it("库面：半截 JSON ⇒ 抛错，且原标记**逐字未变**", () => {
    const dir = pkg();
    mkdirSync(join(dir, ".nudo"), { recursive: true });
    writeFileSync(join(dir, ".nudo", "migrate-retired.json"), BROKEN, "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/migrate-retired\.json/);
    expect(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")).toBe(BROKEN);
    // 一程闸门：package.json 也不得被改
    expect(
      (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        devDependencies: Record<string, string>;
      }).devDependencies["typescript"],
    ).toBe("^5.4.0");
  });

  it("CLI 面：exit 1 + 明确点名标记文件（不得静默 exit 0）", () => {
    const dir = pkg();
    mkdirSync(join(dir, ".nudo"), { recursive: true });
    writeFileSync(join(dir, ".nudo", "migrate-retired.json"), BROKEN, "utf-8");
    const r = runCliTsx(["migrate", "retire", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("migrate-retired.json");
    expect(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")).toBe(BROKEN);
  });

  it("反向闸：标记不存在 ⇒ 照常退役并写下新标记", () => {
    const dir = pkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });
});
