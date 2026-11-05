/**
 * BUG-213 回归：可选成员建模走 `absUnion` ⇒ core 的 `absShapeKey` 在**共享 DAG**
 * 上做去重键（键长 ∝ 路径数）⇒ 指数增长 ⇒ `RangeError: Invalid string length`
 * （或进程 OOM）。同一接口的必选形态毫秒级完成 ⇒ 触发点是「可选」这条路径。
 *
 * 契约：可选成员**有界**完成（不抛错、不指数爆炸），且仍是 `T | undefined`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const N = 27;

function genDts(optional: boolean): string {
  const lines: string[] = ["export interface L0 { x: number; }"];
  for (let i = 1; i < N; i++) lines.push(`export interface L${i} { a: L${i - 1}; b: L${i - 1}; }`);
  lines.push(`export interface Holder { m${optional ? "?" : ""}: L${N - 1}; }`);
  lines.push("export declare function f(): Holder;");
  return lines.join("\n") + "\n";
}

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug213-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const optFile = writeTemp("opt.d.ts", genDts(true));
const reqFile = writeTemp("req.d.ts", genDts(false));

/** `f(): Holder` 的返回面 → Holder brand 的成员表 */
function memberOfHolder(a: Abs, key: string): Abs {
  const shape = a.shape;
  if (shape.k !== "fn") throw new Error("f is not a fn");
  const ret = shape.returnType!.shape;
  if (ret.k !== "brand") throw new Error(`Holder is not a brand: ${ret.k}`);
  // brand 的 `shape` 字段本身是一个 Abs（brand 指向接口的成员面对象）
  const innerShape = (ret as unknown as { shape: Abs }).shape.shape;
  if (innerShape.k !== "obj") throw new Error(`Holder brand has no slots: ${innerShape.k}`);
  const slot = (innerShape as { slots: Record<string, { value: Abs }> }).slots[key];
  if (!slot) throw new Error(`missing member ${key}`);
  return slot.value;
}

describe("BUG-213 —— 可选成员在共享 DAG 上不得指数爆炸", () => {
  it("必选形态完成（基线）", () => {
    const t0 = Date.now();
    const env = harvestDts([reqFile]);
    expect(memberOfHolder(env.globals.f!, "m").shape.k).toBe("brand");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("可选形态同样完成，且成员是 `L26 | undefined`", () => {
    const t0 = Date.now();
    const env = harvestDts([optFile]);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(memberOfHolder(env.globals.f!, "m").shape.k).toBe("sum");
  });
});
