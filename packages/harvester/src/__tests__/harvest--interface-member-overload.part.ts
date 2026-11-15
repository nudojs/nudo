/**
 * Bug 805 回归（harvester 收割面）：接口成员的**重载集**只保留第一个 overload ⇒
 * 第二个 overload 的返回类型被**整体抹除**（假红 + 假绿，与 TS 完全倒置）。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 *   member m = (number) => string
 * 改后：
 *   member m = (number | string) => string | number
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o805-use.ts`：`iov.m("hello")` 赋给 `number`、`iov.m(1)` 赋给 `string`
 *   ⇒ tsc exit=0 ⇒ TS 按**实参类型**选 overload（两个返回类型都在契约里）。
 *
 * 契约：
 *   1. 成员面上的重载集**全部保留**（返回位并集，参数位逐位并集）；
 *   2. 与顶层函数路径（materialize 的 fn 分支，H4 的 Bug 827）**同口径**——
 *      同一实体两条收割路径不得给出两种形态。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug805-"));
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

function returnTypeOf(a: Abs | undefined): string {
  if (!a || a.shape.k !== "fn") return "<not a fn>";
  return formatShape(a.shape.returnType!);
}

function paramTypesOf(a: Abs | undefined): string {
  if (!a || a.shape.k !== "fn") return "<not a fn>";
  return (a.shape.paramTypes ?? []).map((p) => formatShape(p)).join(" | ");
}

describe("Bug 805 —— 接口成员的重载集全部保留", () => {
  it("同名 overload 的返回类型不再被抹除（并集）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    // 改前只有 (number) => string；改后两个返回类型都在
    expect(returnTypeOf(m)).toBe("string | number");
    expect(returnTypeOf(m)).not.toBe("string");
  });

  it("参数位逐位并集（与顶层函数路径同口径）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    expect(paramTypesOf(m)).toBe("number | string");
  });

  it("顶层函数路径与接口成员路径同形（同一实体两条路径不得分叉）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export declare function top(a: number): string;\n` +
        `export declare function top(a: string): number;\n` +
        `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const top = env.globals.top!;
    const member = slots(env.globals.iov!).m!;
    expect(returnTypeOf(member)).toBe(returnTypeOf(top));
    expect(paramTypesOf(member)).toBe(paramTypesOf(top));
  });

  it("单个签名（无重载）不受影响", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface ISingle { m(a: number): string; }\n` +
        `export declare const is: ISingle;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.is!).m!;
    expect(returnTypeOf(m)).toBe("string");
    expect(paramTypesOf(m)).toBe("number");
  });

  it("重载成员仍可调用（relation 面完整：参数位 + 返回位都在）", () => {
    const p = writeTemp(
      "over.d.ts",
      `export interface IOver { m(a: number): string; m(a: string): number; }\n` +
        `export declare const iov: IOver;\n`,
    );
    const env = harvestDts([p]);
    const m = slots(env.globals.iov!).m!;
    expect(m.shape.k).toBe("fn");
    if (m.shape.k !== "fn") return;
    expect((m.shape.paramTypes ?? []).length).toBe(1);
    expect(m.shape.returnType).toBeDefined();
  });
});
