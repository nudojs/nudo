/**
 * Bug 802 回归（harvester 收割面）：元组类型按「**首元素**」近似
 * ⇒ 槽位 ≥1 的元素域是**错的具体类型**（假红 + 假绿）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u802.ts，tsc exit=0）：
 *   `t1: [number, string]` ⇒ `t1[1]` 是 **string**；
 *   `t2: [number, boolean]` ⇒ `t2[1]` 是 **boolean**（赋给 string ⇒ TS 报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   t1: number[]   t2: number[]   t3: number[]     ← 三个不同类型完全同形
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   t1: [number, string]   t2: [number, boolean]   t3: [number, ...string[]]
 *
 * 根因：`mapType` 的元组分支 `for (…) { return absArr(…) }` ⇒ **取首元素就返回**。
 * 这不是精度债，是**错的**具体类型（真实值域与断言值域不相交）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug802-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** tuple 形状的逐槽元素类型（brand / obj 之外直接读 shape） */
function tupleElements(a: unknown): string[] {
  const s = (a as { shape: { k: string; elements?: unknown[] } }).shape;
  if (s.k !== "tuple") return [];
  return (s.elements ?? []).map((e) => formatShape(e as never));
}

describe("Bug 802 —— 元组按逐槽映射（不再按首元素近似）", () => {
  it("[number, string] 的槽位分别是 number / string", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["t1"]!)).toEqual(["number", "string"]);
  });

  it("槽位 ≥1 的元素域是**各自**的类型（不再与首元素相同）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
export declare const t2: [number, boolean];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["t1"]!)).toEqual(["number", "string"]);
    expect(tupleElements(env.globals["t2"]!)).toEqual(["number", "boolean"]);
    // 两个不同元组不再收割成完全相同的东西
    expect(formatShape(env.globals["t1"]!)).not.toBe(formatShape(env.globals["t2"]!));
  });

  it("元组不再是数组（不再折成 number[]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t1: [number, string];
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["t1"]!)).not.toBe("number[]");
    expect(env.globals["t1"]!.shape.k).toBe("tuple");
  });

  it("rest 槽位保留自己的元素类型（[number, ...string[]]）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const t3: [number, ...string[]];
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["t3"]!.shape as { k: string; elements: unknown[]; rest?: unknown };
    expect(shape.k).toBe("tuple");
    expect(shape.elements.map((e) => formatShape(e as never))).toEqual(["number"]);
    expect(formatShape(shape.rest as never)).toBe("string[]");
  });

  it("具名元组成员保留自己的类型", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const tn: [a: number, b: string];
`,
    );
    const env = harvestDts([p]);
    expect(tupleElements(env.globals["tn"]!)).toEqual(["number", "string"]);
  });
});
