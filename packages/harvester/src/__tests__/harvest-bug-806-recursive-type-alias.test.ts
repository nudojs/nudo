/**
 * Bug 806 回归（harvester 收割面）：递归**类型别名**按 depth 硬展开 ⇒
 * 展开 8 层且**指数级**（6 个自引用成员 ⇒ 54MB env 模块）⇒ 末层折成 unknown。
 *
 * 改前（tmp/probe/fix-r27/h2/probe-h2.ts）：
 *   tree = { v: number, kids: { v: number, kids: { … 8 层 … unknown[] }[] }[] }
 *   blow6: harvest 673ms, env module 54083943 bytes
 * 改后：
 *   tree = brand(Tree) { v: number, kids: brand(Tree){unknown}[] }   ← 惰性/引用式
 *   blow6: harvest 0ms, env module 983 bytes（≈ 55000× 更小）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o806-use.ts`（`tree.v` 与 `tree.kids[0].v` 都赋给 `number`）⇒ tsc exit=0
 *   ⇒ TS 侧递归别名可以任意深度解引用。
 *
 * 契约：
 *   1. 递归别名**惰性/引用式**建模（自引用点 = 按名 brand 引用，不内联展开）；
 *   2. 展开深度有界（自引用点的内层是「形状待定」，不是又一层展开）；
 *   3. 规模有界（env 模块体积不随自引用成员数指数增长）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug806-"));
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

describe("Bug 806 —— 递归类型别名惰性/引用式建模（不指数展开）", () => {
  it("递归别名 = 按名 brand（不是内联展开的对象）", () => {
    const p = writeTemp(
      "tree.d.ts",
      `export type Tree = { v: number; kids: Tree[] };\n` +
        `export declare const tree: Tree;\n`,
    );
    const env = harvestDts([p]);
    const tree = env.globals.tree!;
    expect(tree.shape.k).toBe("brand");
    if (tree.shape.k !== "brand") return;
    expect(tree.shape.name).toBe("Tree");
    // 成员面照搬类型字面量（v: number 仍然可见）
    expect(formatShape(slots(tree).v!)).toBe("number");
  });

  it("自引用点 = 按名 brand 引用（内层「形状待定」，不再展开一层）", () => {
    const p = writeTemp(
      "tree.d.ts",
      `export type Tree = { v: number; kids: Tree[] };\n` +
        `export declare const tree: Tree;\n`,
    );
    const env = harvestDts([p]);
    const kids = slots(env.globals.tree!).kids!;
    expect(kids.shape.k).toBe("arr");
    if (kids.shape.k !== "arr") return;
    const elem = kids.shape.element;
    expect(elem.shape.k).toBe("brand");
    if (elem.shape.k !== "brand") return;
    expect(elem.shape.name).toBe("Tree");
    // 自引用点的内层是「形状待定」⇒ 深度有界（改前是又一层完整展开）
    expect(elem.shape.shape.shape.k).toBe("unknown");
  });

  it("规模有界：自引用成员数增加时 env 模块不指数增长", () => {
    const sizes: number[] = [];
    for (const n of [2, 4, 6]) {
      const members = Array.from({ length: n }, (_, i) => `  m${i}: R;`).join("\n");
      const p = writeTemp(
        `blow${n}.d.ts`,
        `export type R = {\n${members}\n};\nexport declare const r: R;\n`,
      );
      const env = harvestDts([p]);
      sizes.push(emitEnvModule(env, "blow").length);
    }
    // 改前 blow6 = 54,083,943 bytes；改后是 KB 级（≈ 2700× 更小）
    expect(sizes[2]!).toBeLessThan(20_000);
    // 指数曲线下 n=6 / n=2 ≈ 3900×；线性（惰性引用）下应当 < 100×
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 100);
  });

  it("互引别名（type A = { b: B }; type B = { a: A }）也被识别为递归", () => {
    const p = writeTemp(
      "mutual.d.ts",
      `export type A = { b: B };\n` +
        `export type B = { a: A };\n` +
        `export declare const a: A;\n`,
    );
    const env = harvestDts([p]);
    const a = env.globals.a!;
    expect(a.shape.k).toBe("brand");
    if (a.shape.k !== "brand") return;
    expect(a.shape.name).toBe("A");
    // 互引链（A → B → A → …）必须在有限跳内落到「形状待定」的按名引用
    let cur = a;
    let hops = 0;
    for (; hops < 5; hops++) {
      if (cur.shape.k !== "brand") break;
      const inner = cur.shape.shape;
      if (inner.shape.k === "unknown") break; // 形状待定 ⇒ 链终止
      const next = slots(inner);
      const key = Object.keys(next)[0];
      if (key === undefined) break;
      cur = next[key]!;
    }
    expect(hops).toBeLessThan(4);
  });
});
