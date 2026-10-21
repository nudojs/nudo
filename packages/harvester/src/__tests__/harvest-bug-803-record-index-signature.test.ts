/**
 * Bug 803 回归（harvester 收割面）：`Record<K,V>` / 索引签名对象被建成
 * **闭**空对象 ⇒ 成员读出 **exact undefined** ⇒ 链式读取定抛 TypeError
 * （假红 + 错值）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u803.ts，tsc exit=0）：
 *   `rec: Record<string, number>` ⇒ `rec.anyKey` 是 **number**；
 *   `recS: Record<string, string>` ⇒ `recS.anyKey` 是 **string**。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   r.shape: {"k":"obj","slots":{}}          ← 闭、无索引值域
 *   r: {  }   r2: {  }                        ← 两个 Record 完全同形
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   r.shape: {"k":"obj","slots":{},"index":{"key":string→…,"value":number},"open":true}
 *
 * 根因：`mapTypeRef` 的 `Record` 分支 `return absObj({})` —— 注释说
 * 「approximated as an open object type」，代码给的是**闭** `absObj({})`
 * ⇒ 注释与实现自相矛盾；索引值域整个丢失。
 *
 * ⚠️ 收割面（`mapTypeMembers` / `mapTypeRef` / `mapType`）在本分片的区间内，
 * 已修；**interface 路径**（`instanceFor`）的索引签名仍被跳过 ——
 * 那是 H2 的区间，见交付报告的「未修 / 保留」段。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug803-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type ObjShape = {
  k: string;
  slots?: Record<string, { value: unknown }>;
  index?: { key: unknown; value: unknown };
  open?: boolean;
};

/** obj / brand 内层 obj 的形状 */
function objShapeOf(a: unknown): ObjShape | undefined {
  const s = (a as { shape: { k: string; shape?: unknown } }).shape;
  if (s.k === "brand") return objShapeOf(s.shape);
  if (s.k === "obj") return s as unknown as ObjShape;
  return undefined;
}

describe("Bug 803 —— Record / 索引签名建成开放对象（带索引值域）", () => {
  it("Record<string, number> 是开放对象且带索引值域 number", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const rec: Record<string, number>;
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["rec"]!)!;
    expect(shape.open).toBe(true);
    expect(shape.index).toBeDefined();
    expect(formatShape(shape.index!.value as never)).toBe("number");
    expect(formatShape(shape.index!.key as never)).toBe("string");
  });

  it("两个不同的 Record **可区分**（改前都是闭空对象、完全同形）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const rec: Record<string, number>;
export declare const recS: Record<string, string>;
`,
    );
    const env = harvestDts([p]);
    const a = objShapeOf(env.globals["rec"]!)!;
    const b = objShapeOf(env.globals["recS"]!)!;
    expect(formatShape(a.index!.value as never)).toBe("number");
    expect(formatShape(b.index!.value as never)).toBe("string");
    expect(formatShape(a.index!.value as never)).not.toBe(
      formatShape(b.index!.value as never),
    );
  });

  it("类型字面量的索引签名也建成开放对象", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { [k: string]: number };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(shape.open).toBe(true);
    expect(formatShape(shape.index!.value as never)).toBe("number");
  });

  it("索引签名 + 具名成员共存时两者都在（具名成员不被索引吞掉）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { known: string; [k: string]: number | string };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(Object.keys(shape.slots ?? {})).toEqual(["known"]);
    expect(shape.open).toBe(true);
    expect(shape.index).toBeDefined();
  });

  it("没有索引签名的类型字面量仍是**闭**对象（开放性不被乱加）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const lit: { a: number };
`,
    );
    const env = harvestDts([p]);
    const shape = objShapeOf(env.globals["lit"]!)!;
    expect(shape.open).toBeUndefined();
    expect(shape.index).toBeUndefined();
  });
});
