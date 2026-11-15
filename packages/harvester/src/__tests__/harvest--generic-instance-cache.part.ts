/**
 * Bug 791 回归（harvester 收割面）：泛型实例化缓存键只编码**实参个数** ⇒
 * 同一接口的不同类型实参命中同一条缓存 ⇒ `Box<number>` 被折成 `Box<string>`。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 *   Box<string>.value=string  Box<number>.value=string  sameAbs=true
 * 改后：
 *   Box<string>.value=string  Box<number>.value=number  sameAbs=false
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o791-use.ts`（`a: Box<string>` / `b: Box<number>` 分别取 `value`）
 *   ⇒ tsc exit=0 ⇒ 两个 `value` 的类型**不同**（string / number）。
 * - `o791-neg.ts`（把 `a.value` 赋给 `number`）⇒ TS2322 ⇒ `Box<string>.value`
 *   确为 string（反证 `Box<number>.value` 确为 number）。
 *
 * 契约（双向）：
 *   1. 不同类型实参 ⇒ 不同实例（缓存键必须编码实参**身份**，不是个数）；
 *   2. 同一类型实参 ⇒ 同一个实例对象（缓存仍然有效，不退化成每次重算）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug791-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

describe("Bug 791 —— 泛型实例化缓存键编码实参身份（不是实参个数）", () => {
  it("不同类型实参 ⇒ 不同实例（改前 Box<number> 被折成 Box<string>）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const b: Box<number>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.b!).value!)).toBe("number");
    // 两个实例不是同一个对象
    expect(env.globals.a).not.toBe(env.globals.b);
  });

  it("同一类型实参 ⇒ 命中缓存（同一个实例对象）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const c: Box<string>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.c!).value!)).toBe("string");
    // 缓存仍有效：同实参 ⇒ 同一个 Abs 实例（不是两份等价副本）
    expect(env.globals.a).toBe(env.globals.c);
  });

  it("实参个数相同、类型不同 ⇒ 不共缓存（个数相同也必须分开）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<string>;\n` +
        `export declare const b: Box<number>;\n` +
        `export declare const c: Box<boolean>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.a!).value!)).toBe("string");
    expect(formatShape(slots(env.globals.b!).value!)).toBe("number");
    expect(formatShape(slots(env.globals.c!).value!)).toBe("boolean");
    expect(new Set([env.globals.a, env.globals.b, env.globals.c]).size).toBe(3);
  });

  it("嵌套实参也按身份区分（Box<Box<string>> ≠ Box<Box<number>>）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { value: T }\n` +
        `export declare const a: Box<Box<string>>;\n` +
        `export declare const b: Box<Box<number>>;\n`,
    );
    const env = harvestDts([p]);
    const innerA = slots(slots(env.globals.a!).value!).value!;
    const innerB = slots(slots(env.globals.b!).value!).value!;
    expect(formatShape(innerA)).toBe("string");
    expect(formatShape(innerB)).toBe("number");
    expect(env.globals.a).not.toBe(env.globals.b);
  });
});
