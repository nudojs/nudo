/**
 * Bug 813 回归（harvester 收割面）：泛型**类型形参默认值**被丢弃 ⇒ 无参引用
 * 留下**未绑定 α**（T）⇒ 引擎侧「未绑定 α」= 无约束值 ⇒ 其上的任意方法调用
 * 被建模为定抛 TypeError（L2 门禁假红）。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 *   Box(no args).v = any
 * 改后：
 *   Box(no args).v = string      （默认值生效）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o813-use.ts`（`box.v.toUpperCase()` 赋给 `string`）⇒ tsc exit=0
 *   ⇒ TS 侧 `Box`（无实参）取形参默认值 `string`。
 *
 * 契约：
 *   1. 类型形参默认值生效（无实参 ⇒ 取默认值）；
 *   2. 无默认值时取约束（TS 语义：推断不出 ⇒ 约束面）；
 *   3. 两者皆无 ⇒ 推断 unknown（不留未绑定 α ⇒ 不产生「定抛」假红）；
 *   4. `Box` ≡ `Box<string>`（默认路径与显式实参路径同形）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug813-"));
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

describe("Bug 813 —— 泛型类型形参默认值生效（不留未绑定 α）", () => {
  it("无实参引用取默认值（改前是 any = 未绑定 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("string");
    // 改前：any（未绑定 α ⇒ 其上方法调用被判「定抛」）
    expect(formatShape(v)).not.toBe("any");
    // 未绑定 α 的形状（any + var term）不得残留
    expect(v.term?.op).not.toBe("var");
  });

  it("`Box` ≡ `Box<string>`（默认路径与显式实参路径同形）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box;\n` +
        `export declare const explicit: Box<string>;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.box!).v!)).toBe("string");
    expect(formatShape(slots(env.globals.explicit!).v!)).toBe("string");
  });

  it("显式实参仍然优先于默认值", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string = string> { v: T }\n` +
        `export declare const box: Box<"lit">;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.box!).v!)).toBe('"lit"');
  });

  it("无默认值时取约束面（不留完全无约束的 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T extends string> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("string");
    expect(v.term?.op).not.toBe("var");
  });

  it("既无默认值也无约束 ⇒ 推断 unknown（不是未绑定 α）", () => {
    const p = writeTemp(
      "box.d.ts",
      `export interface Box<T> { v: T }\n` +
        `export declare const box: Box;\n`,
    );
    const env = harvestDts([p]);
    const v = slots(env.globals.box!).v!;
    expect(formatShape(v)).toBe("unknown");
    expect(v.term?.op).not.toBe("var");
  });

  it("多形参：部分显式 + 其余取默认值", () => {
    const p = writeTemp(
      "pair.d.ts",
      `export interface Pair<A = string, B = number> { a: A; b: B }\n` +
        `export declare const pair: Pair<boolean>;\n`,
    );
    const env = harvestDts([p]);
    const s = slots(env.globals.pair!);
    expect(formatShape(s.a!)).toBe("boolean");
    expect(formatShape(s.b!)).toBe("number");
  });
});
