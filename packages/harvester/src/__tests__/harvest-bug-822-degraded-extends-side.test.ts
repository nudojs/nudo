/**
 * Bug 822 回归（harvester 收割面）：`keyof` / `typeof` / 未解析类型在条件类型的
 * **`extends` 位**被当成 `unknown`（退化哨兵）⇒ 判定**恒为真** ⇒ 条件类型
 * **取错支**（与 TS 相反的确切字面量）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   ko()  => "yes"   （TS："no"  —— "z" 不是 {a,b} 的键）
 *   ko2() => "yes"   （TS："yes" —— 碰巧对）
 *   tq()  => "yes"   （typeof 判不出 ⇒ 不该取支）
 *   un()  => "yes"   （未解析类型 ⇒ 不该取支）
 * 改后：ko() => "no"、ko2() => "yes"、tq()/un() => "yes" | "no"（判不出 ⇒
 * **不取支**，取两支并集）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `"z" extends keyof { a: 1; b: 2 }` 为假（真值 "no"）、
 *   `"a" extends keyof { a: 1; b: 2 }` 为真（真值 "yes"）。
 *
 * 契约（双向）：
 *   1. `extends` 位**判不出**（退化哨兵）⇒ 结果是 **unknown**（三分支里的第三
 *      支）⇒ **不取支**（取两支并集），绝不能当 unknown 恒真；
 *   2. `keyof` **能算出来**时（字面量键名集合）必须**照常判定**
 *      —— 不能因为「keyof 一律判不出」而把 "no" 也放成并集。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug822-"));
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
  `export declare function b822a(): "z" extends keyof { a: 1; b: 2 } ? "yes" : "no";`,
  `export declare function b822b(): "a" extends keyof { a: 1; b: 2 } ? "yes" : "no";`,
  `export declare function b822c(): "z" extends typeof globalThis ? "yes" : "no";`,
  `export declare function b822d(): "z" extends UnresolvedThing ? "yes" : "no";`,
].join("\n");

describe("Bug 822 —— extends 位判不出 ⇒ 不取支（不是恒真）", () => {
  it("keyof 可算 ⇒ 照常判定（\"z\" 不在 {a,b} ⇒ 假）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822a")).toBe('"no"');
    // 反向：不得取真支
    expect(retOf(env, "b822a")).not.toBe('"yes"');
  });

  it("keyof 可算 ⇒ 在键集合里 ⇒ 真（不能一律判不出）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822b")).toBe('"yes"');
    expect(retOf(env, "b822b")).not.toBe('"no"');
  });

  it("typeof 判不出 ⇒ 不取支（两支并集，不是恒真）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b822c");
    expect(s).toContain('"yes"');
    expect(s).toContain('"no"');
    // 反向：不得落成任何一支
    expect(s).not.toBe('"yes"');
    expect(s).not.toBe('"no"');
  });

  it("未解析的类型引用判不出 ⇒ 不取支（两支并集）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b822d");
    expect(s).toContain('"yes"');
    expect(s).toContain('"no"');
    expect(s).not.toBe('"yes"');
    expect(s).not.toBe('"no"');
  });

  it("keyof 的判定方向不随「判不出」放宽（对拍 TS 的两条断言）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b822a")).toBe('"no"');
    expect(retOf(env, "b822b")).toBe('"yes"');
  });
});
