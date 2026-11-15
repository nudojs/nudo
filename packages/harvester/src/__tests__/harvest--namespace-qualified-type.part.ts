/**
 * Bug 792 回归（harvester 收割面）：**命名空间限定**类型引用（`A.Opts`）解析到
 * **所有同名短名接口** ⇒ `A.Opts` 继承了 `B.Opts` 的成员。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3.ts，BEFORE 行）：
 *   useA 的形参 brand 槽位 = { a: number, b: string }   ← 混进了 B.Opts 的 b
 *   useB 的形参 brand 槽位 = { b: string, a: number }
 * 改后：
 *   useA 的形参 brand 槽位 = { a: number }
 *   useB 的形参 brand 槽位 = { b: string }
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o792.ts）：
 *   `oa.b`（`oa: A.Opts`）⇒ TS2339 "Property 'b' does not exist on type 'Opts'"
 *   ⇒ TS 侧 A.Opts 上**没有** b ⇒ 收割面不得有 b。
 *
 * 根因：`ctx.interfaces`（短名桶）不带命名空间身份 ⇒ 限定名解析无条件并入短名桶。
 * 修法：限定名只精确命中自己的限定桶；短名回退**只**认「ambient 模块块里的模块
 * 增强声明」（lodash 形态）——命名空间里的同名接口不再互相并入。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug792-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位名集合 */
function slotNames(a: Abs | undefined): string[] {
  if (!a) return [];
  const s = a.shape;
  if (s.k === "brand") return slotNames(s.shape);
  if (s.k !== "obj") return [];
  return Object.keys(s.slots);
}

/** 函数的第 0 个形参类型（brand） */
function firstParam(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  return a.shape.paramTypes?.[0];
}

const TWO_NS = `declare namespace A { interface Opts { a: number } }
declare namespace B { interface Opts { b: string } }
export declare function useA(o: A.Opts): number;
export declare function useB(o: B.Opts): string;
`;

describe("Bug 792 —— 命名空间限定类型引用不得并入其它命名空间的同名接口", () => {
  it("A.Opts 只有 A 的成员（不含 B.Opts 的 b）", () => {
    const p = writeTemp("ns.d.ts", TWO_NS);
    const env = harvestDts([p]);
    const aSlots = slotNames(firstParam(env.globals.useA!));
    expect(aSlots).toContain("a");
    expect(aSlots).not.toContain("b");
  });

  it("B.Opts 只有 B 的成员（不含 A.Opts 的 a）", () => {
    const p = writeTemp("ns.d.ts", TWO_NS);
    const env = harvestDts([p]);
    const bSlots = slotNames(firstParam(env.globals.useB!));
    expect(bSlots).toContain("b");
    expect(bSlots).not.toContain("a");
  });

  it("对照：单命名空间时成员照常可见（不是「全都丢了」）", () => {
    const p = writeTemp(
      "one.d.ts",
      `declare namespace A { interface Opts { a: number } }
export declare function useA(o: A.Opts): number;
`,
    );
    const env = harvestDts([p]);
    expect(slotNames(firstParam(env.globals.useA!))).toEqual(["a"]);
  });

  it("对照：非限定引用仍解析得到接口成员（既有口径不被破坏）", () => {
    const p = writeTemp(
      "plain.d.ts",
      `interface Opts { a: number }
export declare const o: Opts;
`,
    );
    const env = harvestDts([p]);
    expect(slotNames(env.globals.o!)).toEqual(["a"]);
  });

  it("对照：lodash 形态的模块增强仍与命名空间限定名合并", () => {
    const idx = writeTemp(
      "idx.d.ts",
      `export = _;
export as namespace _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {}
}
`,
    );
    const aug = writeTemp(
      "aug.d.ts",
      `declare module "idx" {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const env = harvestDts([idx, aug]);
    const slots = slotNames(env.globals._!);
    expect(slots).toContain("uniq");
  });
});
