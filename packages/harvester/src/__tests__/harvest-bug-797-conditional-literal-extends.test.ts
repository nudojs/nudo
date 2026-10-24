/**
 * Bug 797 回归（harvester 收割面）：条件类型的 `extends` 判定**只比 prim 标签**
 * ⇒ 字面量信息（在 `term` 上，不在 `shape` 上）被忽略 ⇒
 * `number extends 1` / `"a" extends "b"` / `1 extends 2` **恒判为真**。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   number extends 1  → "yes"   （TS："no"）
 *   "a" extends "b"   → "yes"   （TS："no"）
 *   string extends "a"→ "yes"   （TS："no"）
 *   1 extends 2       → "yes"   （TS："no"）
 * 改后：四条全是 "no"；方向正确的三条（`1 extends 1` / `1 extends number` /
 * `"a" extends string`）仍是 "yes" ⇒ 不是「一律判假」。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `number extends 1` 等四条的真值都是 "no"。
 *
 * 契约（双向）：
 *   1. 字面量 vs 字面量 ⇒ **按值**比（"a" ≠ "b" ⇒ 假；1 = 1 ⇒ 真）；
 *   2. 字面量 vs 类型 ⇒ 字面量可赋值给对应 prim（1 extends number ⇒ 真）；
 *   3. 类型 vs 字面量 ⇒ 假（number extends 1 ⇒ 假，方向不能反）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, getFnImpl, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug797-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? (fn.shape.k === "fn" ? fn.shape.returnType : undefined);
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export declare function b797a(): number extends 1 ? "yes" : "no";`,
  `export declare function b797b(): "a" extends "b" ? "yes" : "no";`,
  `export declare function b797c(): string extends "a" ? "yes" : "no";`,
  `export declare function b797d(): 1 extends 2 ? "yes" : "no";`,
  `export declare function b797e(): 1 extends 1 ? "yes" : "no";`,
  `export declare function b797f(): 1 extends number ? "yes" : "no";`,
  `export declare function b797g(): "a" extends string ? "yes" : "no";`,
].join("\n");

describe("Bug 797 —— extends 判定按字面量值比（不是只比 prim 标签）", () => {
  it("类型 vs 字面量 ⇒ 假（number extends 1 / string extends \"a\"）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797a")).toBe('"no"');
    expect(retOf(env, "b797c")).toBe('"no"');
    // 反向：不得取真支
    expect(retOf(env, "b797a")).not.toBe('"yes"');
    expect(retOf(env, "b797c")).not.toBe('"yes"');
  });

  it("字面量 vs 字面量 ⇒ 按值比（\"a\" vs \"b\" 假；1 vs 1 真；1 vs 2 假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797b")).toBe('"no"');
    expect(retOf(env, "b797d")).toBe('"no"');
    expect(retOf(env, "b797e")).toBe('"yes"');
    // 反向
    expect(retOf(env, "b797b")).not.toBe('"yes"');
    expect(retOf(env, "b797d")).not.toBe('"yes"');
    expect(retOf(env, "b797e")).not.toBe('"no"');
  });

  it("字面量 vs 类型 ⇒ 真（1 extends number / \"a\" extends string）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b797f")).toBe('"yes"');
    expect(retOf(env, "b797g")).toBe('"yes"');
    // 反向：不得取假支（也不能因为「字面量一律判假」而误伤）
    expect(retOf(env, "b797f")).not.toBe('"no"');
    expect(retOf(env, "b797g")).not.toBe('"no"');
  });

  it("判定不是「一律判假」：同值字面量仍然成立", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    // 1 extends 1 / 1 extends number / "a" extends string 三条都是真
    const trues = ["b797e", "b797f", "b797g"].map((n) => retOf(env, n));
    expect(trues).toEqual(['"yes"', '"yes"', '"yes"']);
  });
});
