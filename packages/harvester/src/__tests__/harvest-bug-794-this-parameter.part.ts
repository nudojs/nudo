/**
 * Bug 794 回归（harvester 收割面）：harvester 把 `this` 形参当**普通形参**收割
 * ⇒ **元数错位**（arity +1，第一个真实实参被绑到 `this` 槽）+ 生成的契约草稿
 * **凭空多一个必填参数**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/this/）：
 * - `export declare function withThis(this: Ctx, x: number): string;`
 *   ⇒ 调用方只传 **1** 个实参（`withThis(1)`），`this` 是**调用上下文**的类型标注，
 *   不是实参（TS 编译通过，exit 0）。
 *
 * 收割侧契约：
 *   1. `this` 形参**不是**实参 ⇒ 收割时跳过（不占参数位）；
 *   2. 元数因此正确（`(number) => string`，不是 `(Ctx, number) => string`）；
 *   3. 接口方法签名上的 `this` 形参同口径。
 *
 * ⚠️ 草稿面（`dts-contract-draft.ts`）是 **H8 的文件**：本分片不改它，
 * 对应改法见交付报告（草稿里仍会出现 `this: shape({...})` 这个多余的必填参数）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug794-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 形状的参数位个数 */
function arity(a: unknown): number {
  const shape = (a as { shape?: { k?: string; paramTypes?: unknown[] } }).shape;
  if (shape?.k !== "fn") return -1;
  return shape.paramTypes?.length ?? -1;
}

describe("Bug 794 —— `this` 形参不算实参（元数不因它 +1）", () => {
  it("顶层函数的 `this` 形参被跳过（元数 = 真实实参数）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function withThis(this: Ctx, x: number): string;
export declare function plain(x: number): string;
`,
    );
    const env = harvestDts([p]);
    // 改前：`(Ctx, number) => string`（元数 2，第一个真实实参被绑到 `this` 槽）
    expect(formatShape(env.globals["withThis"]!)).toBe("(number) => string");
    expect(arity(env.globals["withThis"]!)).toBe(1);
    // 对照组不受影响
    expect(formatShape(env.globals["plain"]!)).toBe("(number) => string");
    expect(arity(env.globals["plain"]!)).toBe(1);
  });

  it("`this` 形参的类型不进入参数位", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function withThis(this: Ctx, x: number): string;
`,
    );
    const env = harvestDts([p]);
    const shape = (env.globals["withThis"]! as { shape: { paramTypes: Array<{ shape: { k: string; type?: string } }> } })
      .shape;
    expect(shape.paramTypes).toHaveLength(1);
    expect(shape.paramTypes[0]!.shape.type).toBe("number");
  });

  it("多个真实实参时元数只算真实实参", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Ctx { v: number }
export declare function two(this: Ctx, a: number, b: string): boolean;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["two"]!)).toBe("(number, string) => boolean");
    expect(arity(env.globals["two"]!)).toBe(2);
  });

  it("接口方法签名上的 `this` 形参同口径（不进实例面的参数位）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface I {
  m(this: I, y: string): void;
}
export declare const i: I;
`,
    );
    const env = harvestDts([p]);
    const inst = env.globals["i"]!;
    const slots = (inst as { shape: { shape: { shape: { slots: Record<string, { value: unknown }> } } } }).shape.shape
      .shape.slots;
    const m = slots["m"]!.value as { shape: { k: string; paramTypes?: unknown[] } };
    expect(m.shape.k).toBe("fn");
    expect(m.shape.paramTypes?.length ?? 0).toBe(1);
  });
});
