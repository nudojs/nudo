/**
 * Bug 917 — `migrate strip` 只剥类型、**不改模块系统**：`.cts` 产物里仍是
 * 源侧的 import/export 语法，因此产物形态不得被静默当成 CommonJS。
 *
 * 口径沿革：
 * - 原修复把 `.cts → .js`（不谎称 CommonJS，模块系统由最近的
 *   package.json#type 决定），并在 notes 里如实说明。
 * - Bug 26（类别 08）改为 `.cts → .cjs`，与 tsc / Node 解析序一致且与
 *   `.mts → .mjs` 对称，避免 `.ts` 与 `.cts` 同 stem 时争用同一个 `index.js`
 *   产物（整批产物路径冲突另由 assertUniqueStripProducts 硬错误拦住）。
 *   此时「不谎称」的责任落在 **notes 告警**上：`.cjs` 恒被 Node 当 CommonJS，
 *   若产物仍是 ESM 语法，用户必须先转换模块语法再加载。
 *   `.cjs` 现已是 `isNudoTargetPath` 的目标扩展名，门禁不会零覆盖。
 *
 * 本分片钉的是「映射与说明符同口径 + notes 如实告警」这两条不变量。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 917 — migrate strip 的 .cts 扩展名映射与告警口径", () => {
  it(".cts ⇒ 产物是 .cjs（Bug 26 / tsc 同口径），且 notes 如实说明模块系统未转换", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-917-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a.cts"),
      `export function greet(name: string): string {\n  return name;\n}\n`,
      "utf-8",
    );

    const results = await migrateStrip([dir], { write: true, draft: false });

    // Bug 26：与 tsc / Node 解析序一致，且不再与同 stem 的 .ts 争用 index.js
    expect(existsSync(join(dir, "a.cjs"))).toBe(true);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
    expect(readFileSync(join(dir, "a.cjs"), "utf-8")).toContain("function greet");

    // 如实警告：`.cjs` 恒按 CommonJS 解析，但 strip 产物仍是源侧 ESM 语法
    const notes = results.flatMap((r) => r.notes).join("\n");
    expect(notes).toMatch(/\.cts/);
    expect(notes).toMatch(/does not transform module systems/);
    expect(notes).toMatch(/the \.cjs product/);
  });

  it(".mts ⇒ 产物仍是 .mjs（ESM 源 ⇒ ESM 产物，映射本来就一致）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-917b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.mts"), `export const v: number = 1;\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false });
    expect(existsSync(join(dir, "a.mjs"))).toBe(true);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
  });
});
