/**
 * Bug 583 — `migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。
 *
 * 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」
 * （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。
 * 改前：`.jsx` 落盘、exit 0、零告警（`node --check` 直接 ERR_UNKNOWN_FILE_EXTENSION；
 * `.jsx` 也不在 isNudoTargetPath 里 ⇒ check / verify 都看不见它）。
 *
 * 期望：要么不迁移、要么产出**可加载**的 JS；notes 要如实 ⇒ strip 拒绝迁移 JSX 源。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TSX_SRC = `export function Comp(props: { name: string }) {\n  return <div className="x">{props.name}</div>;\n}\n`;

describe("Bug 583 — migrate strip 不产出加载不了的 .jsx", () => {
  it(".tsx ⇒ 明确报错（不静默 exit 0），且不落任何产物", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583-"));
    dirs.push(dir);
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");

    await expect(migrateStrip([join(dir, "Comp.tsx")], { write: true, draft: false })).rejects.toThrow(
      /JSX/,
    );

    // 改前：Comp.jsx 落盘（Node: ERR_UNKNOWN_FILE_EXTENSION）
    expect(existsSync(join(dir, "Comp.jsx"))).toBe(false);
    expect(existsSync(join(dir, "Comp.js"))).toBe(false);
  });

  it("目录里有 .tsx ⇒ 整批不落盘（不留半写状态）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), `export const a = 1;\n`, "utf-8");
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");

    await expect(migrateStrip([dir], { write: true, draft: false })).rejects.toThrow(/JSX/);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
  });

  it("报错信息说明 strip 不做 JSX 变换（可操作）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");
    const err = await migrateStrip([join(dir, "Comp.tsx")], { write: true, draft: false }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect((err as Error).message).toMatch(/Comp\.tsx/);
    expect((err as Error).message).toMatch(/no JSX transform/);
  });
});
