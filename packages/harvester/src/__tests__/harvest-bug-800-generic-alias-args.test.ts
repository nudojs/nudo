/**
 * Bug 800 回归（harvester 收割面）：泛型**别名** `Box<number>` 与 `Box<string>`
 * **完全相同**且成员值域丢失（`{ v: unknown }`）（错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u800.ts，tsc exit=0）：
 *   `type Box<T> = { v: T }` ⇒ `bn: Box<number>` 的 `.v` 是 **number**，
 *   `bs: Box<string>` 的 `.v` 是 **string**（`bn.v` 赋给 string ⇒ TS 报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   a: { v: unknown }   b: { v: unknown }   same? true
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   a: { v: number }    b: { v: string }    same? false
 *
 * 根因：`mapTypeRef` 的别名分支直接展开别名体、**丢弃实参** ⇒ 别名体内的
 * `T` 没有实参可代入 ⇒ 落到 `unknown`。同一文件里**接口**路径
 * （`instanceFor(ctx, name, args…)`）却是会代入实参的 ⇒ 同一语义、
 * 不同路径的成对缺口。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug800-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → 类型显示串） */
function memberSlots(a: unknown): Record<string, string> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = formatShape(v.value as never);
    return out;
  }
  return {};
}

describe("Bug 800 —— 泛型别名按类型实参实例化（实参不再被丢弃）", () => {
  it("Box<number> / Box<string> 的成员值域分别是 number / string", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export declare const a: Box<number>;
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).toBe("{ v: number }");
    expect(formatShape(env.globals["b"]!)).toBe("{ v: string }");
  });

  it("两个实例**可区分**（改前完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export declare const a: Box<number>;
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).not.toBe(formatShape(env.globals["b"]!));
  });

  it("别名路径与接口路径**同口径**（两者都会代入实参）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Box<T> = { v: T };
export interface IBox<T> { v: T }
export declare const a: Box<number>;
export declare const b: IBox<number>;
`,
    );
    const env = harvestDts([p]);
    // 接口路径产出的是 brand（显示名 IBox），别名路径产出的是 obj ⇒
    // 比较**成员面**（同口径），不是显示串
    expect(memberSlots(env.globals["a"]!)).toEqual({ v: "number" });
    expect(memberSlots(env.globals["b"]!)).toEqual({ v: "number" });
  });

  it("别名体内是数组时也代入实参（Box<T> = T[]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type List<T> = T[];
export declare const a: List<number>;
export declare const b: List<string>;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["a"]!)).toBe("number[]");
    expect(formatShape(env.globals["b"]!)).toBe("string[]");
  });

  it("非泛型别名不受影响（不凭空多出实参）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export type Pair = { a: number; b: string };
export declare const p: Pair;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["p"]!)).toBe("{ a: number, b: string }");
  });
});
