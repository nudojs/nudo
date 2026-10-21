/**
 * Bug 799 回归（harvester 收割面）：交叉类型 `A & B` **只保留 A**
 * ⇒ `Point & Size` 与 `Point` 在 Abs 层面**完全不可区分**（错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u799.ts，tsc exit=0）：
 *   `interface Point { x: number; y: number }` + `interface Size { w: number; h: number }`
 *   ⇒ `ps: Point & Size` 的 `.x` / `.w` **都是 number**（交叉类型的成员是并集）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   ps: Point      pt: Point      same? true     ← Size 的成员整个没了
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   ps: { x: number, y: number, w: number, h: number }   pt: Point   same? false
 *
 * 根因：`mapType` 的交叉分支的合并守卫要求每个成员都是 `obj` 形状，
 * 而**接口引用经 `instanceFor` 产出的是 `brand` 形状** ⇒ 守卫失败 ⇒
 * `return members[0]`（只留第一侧）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug799-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员名（取自 Abs 的槽面） */
function memberNames(a: unknown): string[] {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberNames(s.shape);
  if (s.k === "obj") return Object.keys(s.slots ?? {});
  return [];
}

describe("Bug 799 —— 交叉类型合并两侧成员（不再只保留 A）", () => {
  it("Point & Size 的成员是并集（x/y/w/h 四个）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
export declare const pt: Point;
`,
    );
    const env = harvestDts([p]);
    const ps = env.globals["ps"]!;
    const names = memberNames(ps).sort();
    expect(names).toEqual(["h", "w", "x", "y"]);
  });

  it("交叉类型与单侧**可区分**（改前两者完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
export declare const pt: Point;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["ps"]!)).not.toBe(formatShape(env.globals["pt"]!));
    // 反向钉：交叉类型不能塌回单侧 Point
    expect(formatShape(env.globals["ps"]!)).not.toBe("Point");
  });

  it("成员的值域保留（不是 unknown / never）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export declare const ps: Point & Size;
`,
    );
    const env = harvestDts([p]);
    const shape = formatShape(env.globals["ps"]!);
    expect(shape).toContain("x: number");
    expect(shape).toContain("w: number");
    expect(shape).not.toContain("unknown");
  });

  it("同名冲突成员取 never（TS 的 A & B 属性冲突语义）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface A { v: number }
export interface B { v: string }
export declare const ab: A & B;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["ab"]!)).toContain("never");
  });

  it("纯字面量交叉（无对象面）不崩，兜底取第一侧", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const s: string & { a: number };
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["s"]).toBeDefined();
  });
});
