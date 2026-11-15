/**
 * Bug 969 — `migrate strip <file>`（单文件路径）不迁移既有的 `*.nudo.ts` 侧车。
 *
 * 根因：单文件路径只处理「用户点名的那个文件」⇒ 源模块迁到 `.js` 后，
 * 它的侧车还留在 `.nudo.ts` ⇒ 产物 `lib.js` 的侧车（`lib.nudo.js`）不存在
 * ⇒ 产物静默变成「无契约」（目录路径会迁侧车，单文件路径不会 ⇒ 两条路径不一致）。
 *
 * 期望：单文件路径与目录路径走**同一条**迁移逻辑 ⇒ 既有侧车一并改名迁移
 * （`lib.nudo.ts` → `lib.nudo.js`），产物的契约不丢。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LIB_TS = `export function f(x) {\n  return x;\n}\n\nexport function caller() {\n  return f(1);\n}\n`;
const SIDECAR = `export const f = fn({ x: number().gt(10) });\n`;

describe("Bug 969 — 单文件 strip 也迁移既有侧车", () => {
  it("既有 lib.nudo.ts ⇒ 产物侧车 lib.nudo.js 被创建（契约不丢）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969-"));
    dirs.push(dir);
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");
    writeFileSync(join(dir, "lib.nudo.ts"), SIDECAR, "utf-8");

    const results = await migrateStrip([join(dir, "lib.ts")], { write: true, draft: false });

    // 改前：lib.nudo.js 不存在 ⇒ 产物变成「无契约」
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
    expect(readFileSync(join(dir, "lib.nudo.js"), "utf-8")).toContain("number().gt(10)");
    // 迁移动作可观测
    expect(results.flatMap((r) => r.notes).join("\n")).toMatch(/sidecar migrated/);
  });

  it("目录路径与单文件路径落到同一个侧车产物（口径一致）", async () => {
    const dirFile = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969f-"));
    const dirDir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969d-"));
    dirs.push(dirFile, dirDir);
    for (const d of [dirFile, dirDir]) {
      writeFileSync(join(d, "lib.ts"), LIB_TS, "utf-8");
      writeFileSync(join(d, "lib.nudo.ts"), SIDECAR, "utf-8");
    }
    await migrateStrip([join(dirFile, "lib.ts")], { write: true, draft: false });
    await migrateStrip([dirDir], { write: true, draft: false });
    expect(readFileSync(join(dirFile, "lib.nudo.js"), "utf-8")).toBe(
      readFileSync(join(dirDir, "lib.nudo.js"), "utf-8"),
    );
  });

  it("迁移后产物的契约仍然生效（check 不再是绿的假象）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");
    writeFileSync(join(dir, "lib.nudo.ts"), SIDECAR, "utf-8");

    const r = runCliTsx(["migrate", "strip", "lib.ts", "--write", "--no-draft"], { cwd: dir });
    expect(r.status).toBe(0);

    // 改前：产物无侧车 ⇒ check 绿（契约丢了，零告警）
    const check = runCliTsx(["check", "lib.js"], { cwd: dir });
    expect(check.status).not.toBe(0);
  }, 120_000);
});
