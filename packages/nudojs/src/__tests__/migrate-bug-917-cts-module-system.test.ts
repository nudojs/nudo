/**
 * Bug 917 — `migrate strip` 把 `.cts` 映射成 `.cjs`，**断言产物是 CommonJS**，
 * 而 strip 只剥类型（不改模块系统）⇒ 产物里仍是 ESM 语法 ⇒ Node 加载不了，
 * 且 `.cjs` 不在门禁分析目标集内（isNudoTargetPath）⇒ 零覆盖、零告警。
 *
 * 期望：扩展名映射要与**实际产物形态**一致（或如实警告）。
 * 本分片的取舍：`.cts → .js`（不谎称 CommonJS；模块系统由最近的
 * package.json#type 决定），并在 notes 里如实说明 strip 不做模块系统转换。
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

describe("Bug 917 — migrate strip 的 .cts 扩展名映射不谎称 CommonJS", () => {
  it(".cts ⇒ 产物是 .js（不是 .cjs），且 notes 如实说明模块系统未转换", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-917-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a.cts"),
      `export function greet(name: string): string {\n  return name;\n}\n`,
      "utf-8",
    );

    const results = await migrateStrip([dir], { write: true, draft: false });

    // 改前：a.cjs（断言 CommonJS，但内容是 ESM 语法 ⇒ Node 加载不了）
    expect(existsSync(join(dir, "a.cjs"))).toBe(false);
    expect(existsSync(join(dir, "a.js"))).toBe(true);
    expect(readFileSync(join(dir, "a.js"), "utf-8")).toContain("function greet");

    // 如实警告：产物保留源模块语法，模块系统由 package.json#type 决定
    const notes = results.flatMap((r) => r.notes).join("\n");
    expect(notes).toMatch(/\.cts/);
    expect(notes).toMatch(/does not transform module systems/);
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
