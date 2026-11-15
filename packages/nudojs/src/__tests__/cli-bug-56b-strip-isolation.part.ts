/**
 * 族 56b · Bug 696 的**库面半边** —— `migrateStrip` 的**逐文件错误隔离**。
 *
 * 背景（台账原描述「`migrate verify` 库面整批 abort」经 W4 取证**已不成立**）：
 * `migrateVerify` 早已逐文件隔离（同目标内部分文件语法错 ⇒ 失败文件记
 * `analysis-error`、成功文件照常返回）；仍整批 abort 的是同族的 `migrateStrip`
 * ——`planStrip` → `makeStripPlan` 遇解析错即 `throw` ⇒ 同目标内其它文件的
 * 成功结果**全丢**（且与 verify 的口径不一致）。
 *
 * 本片修法：解析失败**降级成一行错误**（结构与 `migrateVerify` 的逐文件错误行
 * **同款**：`code` + `error`，`error` 带文件名）⇒ 库面与 verify 同口径。
 *
 * 必须保持的不变量：
 * 1. **整批零写盘的原子性不变**（任一文件失败 ⇒ 不写任何产物）——正确形态是
 *    「**先算完全部结果（含错误行）⇒ 再决定写不写**」，**不是**部分写盘。
 * 2. **CLI 面的既有行为与 stdout 逐字不变**（既有金标钉了 `migrate strip` 的
 *    输出）⇒ CLI 侧把失败行映射回**旧版逐字同形**的失败条目。
 *
 * 反向闸（断言非永真）：
 * - 混合目录（好文件 + 语法错文件）⇒ 库面**不 throw**、好文件的行**仍返回**；
 * - 同一目录**零写盘**（连好文件也不落盘）；
 * - 失败行**带文件名** + 失败码与 `migrateVerify` **同码**；
 * - 负控：**全部成功**时，返回行的字段**逐字不变**（无 `code` / `error` 键）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip, migrateVerify } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-56b-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("族 56b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）", () => {
  it("同目标内一个文件语法错 ⇒ 库面不 throw + 成功文件的结果仍返回", async () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    const rows = await migrateStrip([dir], { write: true, draft: false });

    // 好文件的行**仍返回**（改前：整批 throw ⇒ 全丢）
    const good = rows.filter((r) => r.file.endsWith("a-good.ts"));
    expect(good).toHaveLength(1);
    expect(good[0]!.outFile.endsWith("a-good.js")).toBe(true);
    // 成功行不带失败字段
    expect(good[0]!.code).toBeUndefined();
    expect(good[0]!.error).toBeUndefined();
    // 失败文件记一行错误（不抛）
    const bad = rows.filter((r) => r.file.endsWith("z-bad.ts"));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.code).toBeTruthy();
  });

  it("原子性仍成立 ⇒ 有失败时一个字节都不落盘（含好文件）", async () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    await migrateStrip([dir], { write: true, draft: false });

    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("失败行带文件名 + 失败码与 migrateVerify 同码（同款结构）", async () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    const stripRows = await migrateStrip([dir], { write: false, draft: false });
    const stripFail = stripRows.find((r) => r.code !== undefined);
    expect(stripFail).toBeDefined();
    // 文件名：错误行自带文件名（定位用）
    expect(String(stripFail!.error)).toContain("z-bad.ts");
    expect(stripFail!.file.endsWith("z-bad.ts")).toBe(true);
    // 结构与 migrateVerify 的逐文件错误行同款：`code` + `error` 两个可选字段
    expect(typeof stripFail!.code).toBe("string");
    expect(typeof stripFail!.error).toBe("string");

    // 同码：verify 对同一个语法错文件发的失败码与 strip **一致**
    const verifyRows = await migrateVerify([join(dir, "z-bad.ts")]);
    const verifyFail = verifyRows.find((r) => r.nudoOk === false);
    expect(verifyFail).toBeDefined();
    expect(stripFail!.code).toBe(verifyFail!.code);
  });

  it("负控：全部成功 ⇒ 返回行的字段逐字不变（无 code / error 键）", async () => {
    const dir = dirWith({ "a-good.ts": GOOD });

    const rows = await migrateStrip([dir], { write: false, draft: false });

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["file", "notes", "outFile"]);
    expect(rows[0]!.notes).toEqual([]);
  });

  it("CLI 面：失败目标的 stdout/stderr 与旧版逐字同形（失败详情带文件名）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{
      ok?: boolean;
      action?: string;
      results?: unknown[];
      pathErrors?: Array<{ path: string; code: string; message: string }>;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 失败详情带**文件名**（机器面）
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0]?.message).toContain("z-bad.ts");
    expect(parsed.pathErrors?.[0]?.code).toBe("nudo:migrate-strip-failed");
    expect(r.stderr).toContain("z-bad.ts");
  });
});
