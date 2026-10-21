/**
 * Bug 816 回归（harvester 收割面）：条件类型的 `extends` 判定在 **brand-vs-brand**
 * 上**只比名字** ⇒ 结构相同、名字不同的两个 interface 被判「不 extends」⇒
 * 条件类型**确定地**走错分支（**硬错值**：与 TS 相反的确切字面量）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   same() => "no"   （TS："yes" —— A/B 结构相同）
 *   diff() => "no"   （TS："no"  —— A/C 成员类型不同，碰巧对）
 *   self() => "yes"  （TS："yes" —— 靠**同名**蒙对）
 * 改后：same() => "yes"、diff() => "no"、self() => "yes"。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `B816A extends B816B` 成立（结构可赋值）、`B816A extends B816C` 不成立。
 *
 * 契约（双向）：
 *   1. brand 比较要看**结构**（同构即等），不能只比名字；
 *   2. 结构不同 ⇒ 仍然判假（不是「一律判真」的放宽）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug816-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 函数的**返回类型**展示面（relation 优先） */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const fn = env.globals[name]!;
  const rel = getFnImpl(fn)?.relation;
  const rt = rel?.returnType ?? fn.shape?.returnType;
  return rt ? formatShape(rt) : "<none>";
}

const decls = [
  `export interface B816A { x: number }`,
  `export interface B816B { x: number }`,
  `export interface B816C { x: string }`,
  `export declare function b816a(): B816A extends B816B ? "yes" : "no";`,
  `export declare function b816b(): B816A extends B816C ? "yes" : "no";`,
  `export declare function b816c(): B816A extends B816A ? "yes" : "no";`,
].join("\n");

describe("Bug 816 —— brand-vs-brand 按结构判 extends（不是只比名字）", () => {
  it("结构相同的两个 interface ⇒ 判真（改前按名字判假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816a")).toBe('"yes"');
    // 反向：不得取假支
    expect(retOf(env, "b816a")).not.toBe('"no"');
  });

  it("结构不同的两个 interface ⇒ 判假（不能因为放宽而一律判真）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816b")).toBe('"no"');
    expect(retOf(env, "b816b")).not.toBe('"yes"');
  });

  it("同名 interface ⇒ 判真（不得被结构口径改坏）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b816c")).toBe('"yes"');
    expect(retOf(env, "b816c")).not.toBe('"no"');
  });

  it("多成员结构相同 ⇒ 判真；源上**缺成员** ⇒ 判假", () => {
    const p = writeTemp(
      "a.d.ts",
      `export interface P { x: number; y: string }` +
        `export interface Q { x: number; y: string }` +
        `export interface R { x: number }` +
        `export declare function same(): P extends Q ? "yes" : "no";` +
        `export declare function extra(): P extends R ? "yes" : "no";` +
        `export declare function fewer(): R extends P ? "yes" : "no";`,
    );
    const env = harvestDts([p]);
    expect(retOf(env, "same")).toBe('"yes"');
    // 源上多出成员仍然可赋值（TS：P extends R 成立）
    expect(retOf(env, "extra")).toBe('"yes"');
    // 源上**缺**成员 ⇒ 不可赋值
    expect(retOf(env, "fewer")).toBe('"no"');
    expect(retOf(env, "fewer")).not.toBe('"yes"');
  });
});
