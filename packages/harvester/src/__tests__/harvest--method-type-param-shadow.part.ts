/**
 * Bug 810 回归（harvester 收割面）：泛型**方法**自带类型形参与**接口**形参
 * **同名** ⇒ 接口的 α 代入把方法自身的 α 一并替换 ⇒ 方法被**去泛型化**
 * ⇒ `sh.m("text")` 折 `number`（真值 `string`）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u810.ts，tsc exit=0）：
 *   `interface Shadow<T> { v: T; m<T>(x: T): T }` + `sh: Shadow<number>`
 *   ⇒ `sh.v` 是 number（接口的 T）；
 *     `sh.m("text")` 是 **string**（方法自己的 `<T>` **就近遮蔽**接口的 `<T>`，
 *     m 对任意参数返回同类型）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   sh.v: string   sh.m: (string) => string    ← 方法被接口的实参去泛型化
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   sh.v: string   sh.m: (T@1fu64lg34) => T@1fu64lg34   ← 方法的 α 活着
 *
 * 根因：`ctx.typeParams` 是一个**扁平集合**（接口的 `T` 与方法自己的 `T`
 * 混在一起）⇒ `substAbs` 代入接口实参时把方法内部的 α 一并替换。
 *
 * 修法：α 身份按**作用域**隔离 —— `typeParamVarId` 取「AST 链上最近的
 * 声明者」；同名若还被外层声明过（= 遮蔽），内层用独立 id（`T@<tag>`）
 * ⇒ 外层代入不再穿透它。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug810-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → Abs） */
function memberSlots(a: unknown): Record<string, unknown> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = v.value;
    return out;
  }
  return {};
}

/** fn 形状的 α term id 列表 */
function varIds(a: unknown): string[] {
  const s = (a as { shape: { k: string; paramTypes?: unknown[]; returnType?: unknown } }).shape;
  const out: string[] = [];
  const push = (x: unknown): void => {
    const t = (x as { term?: { op: string; id?: string } })?.term;
    if (t?.op === "var" && t.id) out.push(t.id);
  };
  for (const p of s.paramTypes ?? []) push(p);
  push(s.returnType);
  return out;
}

describe("Bug 810 —— 方法的类型形参遮蔽外层同名形参（α 作用域隔离）", () => {
  it("接口的 α 照常代入（sh.v 是实参类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    expect(formatShape(slots["v"] as never)).toBe("string");
  });

  it("方法自己的 α **不被**接口实参替换（方法仍是泛型的）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    const m = slots["m"] as { shape: { k: string; paramTypes?: unknown[]; returnType?: unknown } };
    expect(m.shape.k).toBe("fn");
    const ids = varIds(m);
    expect(ids.length).toBeGreaterThan(0);
    // 方法的 α 不得是接口实参「string」——必须仍是一个自由 var
    for (const id of ids) expect(id).not.toBe("string");
    // 反向钉：方法不能被去泛型化成 (string) => string
    expect(formatShape(m as never)).not.toBe("(string) => string");
  });

  it("遮蔽的 α 与外层 α 是**不同**的身份", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shadow<T> { v: T; m<T>(x: T): T }
export declare const sh: Shadow<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["sh"]!);
    const m = slots["m"] as { shape: { paramTypes?: unknown[]; returnType?: unknown } };
    const ids = varIds(m);
    // 形参与返回位是同一个 α（同一个方法作用域）
    expect(new Set(ids).size).toBe(1);
    // 且它带作用域 tag（`T@…`），与外层裸名 `T` 不同
    expect(ids[0]).toMatch(/^T@/);
  });

  it("无同名遮蔽时，方法的 α 仍可被接口实参代入（不误伤）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Box<T> { v: T; m<U>(x: U): U }
export declare const b: Box<string>;
`,
    );
    const env = harvestDts([p]);
    const slots = memberSlots(env.globals["b"]!);
    expect(formatShape(slots["v"] as never)).toBe("string");
    // 方法自己的 U 仍然是自由 var（接口没有同名 U 可代入）
    const ids = varIds(slots["m"]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0]).not.toBe("string");
  });
});
