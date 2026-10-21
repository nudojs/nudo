/**
 * Bug 596 — `migrate strip` 的 notes 用**裸正则**扫源码 ⇒ 注释 / 字符串里的
 * "enum " / "namespace " 被当成声明 ⇒ 提示与事实相反。
 *
 * 根因：notes 由 `/\benum\s+[A-Za-z_$]/.test(source)` 这类正则产生，
 * 而真正的剥除事实只有 AST 知道（core strip-types 的解析结果）。
 *
 * 期望：notes 基于 AST 事实——真 enum 才提示「enum 被删」，
 * 真（非 declare）namespace 才提示「可能打印不干净」。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function notesOf(src: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-596-"));
  dirs.push(dir);
  writeFileSync(join(dir, "c.ts"), src, "utf-8");
  const results = await migrateStrip([join(dir, "c.ts")], { write: true, draft: false });
  return results.flatMap((r) => r.notes);
}

describe("Bug 596 — migrate strip 的 notes 基于 AST 事实", () => {
  it("注释 / 字符串里的 enum / namespace ⇒ 不产生提示", async () => {
    const notes = await notesOf(
      `export function f(x: number): number {\n  // TODO: convert this enum later\n  const s = "the namespace is fine";\n  return x + 1;\n}\n`,
    );
    expect(notes.join("\n")).not.toMatch(/enum/);
    expect(notes.join("\n")).not.toMatch(/namespace/);
  });

  it("真 enum ⇒ 提示「enum 被删」", async () => {
    const notes = await notesOf(`export enum E { A, B }\n`);
    expect(notes.join("\n")).toMatch(/enum/);
  });

  it("真 namespace（非 declare）⇒ 提示「可能打印不干净」", async () => {
    const notes = await notesOf(`namespace NS {\n  export const x = 1;\n}\n`);
    expect(notes.join("\n")).toMatch(/namespace/);
  });

  it("declare namespace ⇒ 不提示（它被删掉了，打印不干净不成立）", async () => {
    const notes = await notesOf(`export declare namespace D {\n  const x: number;\n}\n`);
    expect(notes.join("\n")).not.toMatch(/namespace/);
  });

  it("export as namespace X ⇒ 不提示 namespace（不是 namespace 声明）", async () => {
    const notes = await notesOf(`export as namespace MyGlobal;\nexport const y = 1;\n`);
    expect(notes.join("\n")).not.toMatch(/namespace/);
  });
});
