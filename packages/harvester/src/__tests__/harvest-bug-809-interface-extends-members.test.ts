/**
 * Bug 809 回归（harvester 收割面）：接口 `extends` 的**继承成员在实例模型里整体消失**
 * ⇒ `derived.b` 折 `undefined`、`.length` **定抛 TypeError**（L2 假红）。
 *
 * 根因：收接口成员时只搬接口**自身**声明的成员，**不解析 `extends` 子句**
 * ⇒ 继承来的成员在实例模型里根本不存在 → 成员读落到「无此槽」→ 折 exact
 * `undefined` → 后续 `.length` 被判「确定抛 TypeError」。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：
 *   brand Derived 槽位 = { d: number }        ← 继承来的 b 整条消失
 * 改后：
 *   brand Derived 槽位 = { d: number, b: string }
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o809.ts）：exit=0
 *   `derived.b` 是 string、`derived.b.length` 是 number ⇒ TS 侧继承成员必然存在。
 *
 * 产品面（`nudo check`，tmp/probe/fix-r27/h3/e2e/inherit/）：
 *   改前 `readBaseFieldLen() => never  throws TypeError`（L2 假红）
 *   改后 `readBaseFieldLen() => number`
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug809-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
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

const EXTENDS = `export interface Base { b: string; }
export interface Derived extends Base { d: number; }
export declare const derived: Derived;
export declare const base: Base;
`;

describe("Bug 809 —— 接口 extends 的继承成员并入实例模型", () => {
  it("Derived 的实例面含基接口的成员 b", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    const s = slots(env.globals.derived!);
    expect(Object.keys(s).sort()).toEqual(["b", "d"]);
    expect(formatShape(s.b!)).toBe("string");
    expect(formatShape(s.d!)).toBe("number");
  });

  it("继承来的成员不是「读不到」（不是 exact undefined）", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    const s = slots(env.globals.derived!);
    expect(formatShape(s.b!)).not.toBe("undefined");
    expect(s.b!.term?.op).not.toBe("lit");
  });

  it("对照：基接口自身只有自己的成员（不被子接口的成员污染）", () => {
    const p = writeTemp("ext.d.ts", EXTENDS);
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.base!)).sort()).toEqual(["b"]);
  });

  it("对照：多级继承链（extends 递归）", () => {
    const p = writeTemp(
      "chain.d.ts",
      `export interface A1 { a: number; }
export interface A2 extends A1 { b: string; }
export interface A3 extends A2 { c: boolean; }
export declare const a3: A3;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.a3!)).sort()).toEqual(["a", "b", "c"]);
  });

  it("对照：无 extends 时成员表不变（既有口径不被破坏）", () => {
    const p = writeTemp(
      "plain.d.ts",
      `export interface Plain { x: number; }
export declare const plain: Plain;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.plain!))).toEqual(["x"]);
  });
});
