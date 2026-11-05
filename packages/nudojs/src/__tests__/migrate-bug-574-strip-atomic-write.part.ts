/**
 * Bug 574 — `migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。
 *
 * 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚；
 * 异常路径也不携带文件名（只有 Babel 的 "Unexpected token (2:12)"）。
 *
 * 期望：要么全不写，要么明确报告失败于哪个文件 ⇒ 两阶段（先算完再写）+ 事务写盘。
 *
 * ⚠ 族 56b（**断言的通道变了，断言的强度没变**）：库面改**逐文件隔离**⇒ 解析失败
 * **不再整批 throw**，而是降级成**一行错误**（`code` + `error`，带文件名；结构同
 * `migrate verify` 的逐文件错误行）⇒ 同目标内其它文件的成功结果照常返回。
 * 本钉的两条断言因此从「promise reject」改到「返回的失败行」——
 * **断言的要点逐条保留**：错误信息点名文件 + 错误信息带解析位置 + 一个字节都不落盘。
 * （半写状态这条**不变**：有失败 ⇒ 整批零写盘。）
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 574 — migrate strip --write 是原子的（无半写状态）", () => {
  it("语法错文件 ⇒ 报错点名文件 + 一个字节都不落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a-good.ts"),
      `export function ok(a: number): number {\n  return a + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "z-bad.ts"),
      `export function oops(a: number): number {\n  return a +;\n}\n`,
      "utf-8",
    );

    // 错误信息必须点名文件（改前只有 "Unexpected token (2:12)"）
    // 族 56b：失败以**一行错误**返回（不再整批 throw）⇒ 断言改到失败行上。
    const rows = await migrateStrip([dir], { write: true, draft: false });
    const failed = rows.filter((r) => r.code !== undefined);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/z-bad\.ts/);

    // 半写状态：改前 a-good.js 已落盘 ⇒ 现在必须没有任何产物
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("语法错文件 ⇒ 错误信息同时含文件名与解析位置", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "bad.ts"), `const x = ;\n`, "utf-8");
    // 族 56b：失败以**一行错误**返回（`code` + `error`）—— 断言要点不变。
    const rows = await migrateStrip([dir], { write: true, draft: false });
    const failed = rows.filter((r) => r.code !== undefined);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/bad\.ts/);
    expect(failed[0]!.error).toMatch(/\(1:\d+\)/);
  });
});
