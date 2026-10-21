/**
 * Bug 823 回归（harvester 收割面）：外层条件类型的**真支本身是嵌套条件类型**时，
 * 真支被 `infer` 变量**顶替** ⇒ 返回**错误确切字面量**（与 TS 相反）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   nst()  => any    ← 真支（嵌套条件类型）被 infer 变量 E 顶替
 *   nst2() => any
 * 改后：
 *   nst()  => "s" | "n" | "x"   ← 真支**递归求值**（"s"/"n"）+ 假支 "x"
 *   nst2() => any                ← 真支**就是** infer 变量（合法的 α 捷径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定 `b823(["a"])` 的类型是 "s"（外层真支 → 内层 `E extends string`
 *   成立 ⇒ "s"）；改前的 "any" 与之相反（把元素值域当成了结果）。
 *
 * 契约（双向）：
 *   1. 真支是**嵌套条件类型** ⇒ 必须**递归求值**（真支的取值出现在结果里），
 *      不得被 infer 变量顶替；
 *   2. 真支**就是** infer 变量 ⇒ 仍走 α 捷径（`relation.inferFrom` 在位，
 *      调用点能绑出元素类型）—— 不能把这条路径一起砍掉。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug823-"));
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
  `export declare function b823<T>(x: T): T extends (infer E)[] ? (E extends string ? "s" : "n") : "x";`,
  `export declare function b823b<T>(x: T): T extends (infer E)[] ? E : "x";`,
].join("\n");

describe("Bug 823 —— 真支是嵌套条件类型 ⇒ 递归求值（不被 infer 变量顶替）", () => {
  it("嵌套条件类型的真支被递归求值（真支取值出现在结果里）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b823");
    // 真支（嵌套条件类型）的两个取值都在
    expect(s).toContain('"s"');
    expect(s).toContain('"n"');
    // 假支也在（外层未决 ⇒ 保守并集）
    expect(s).toContain('"x"');
  });

  it("不再返回 infer 变量顶替出来的错误确切值", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const s = retOf(env, "b823");
    // 反向：不得只剩 α（"any"）、不得只剩假支 "x"、不得是元素值域
    expect(s).not.toBe("any");
    expect(s).not.toBe('"x"');
    expect(s).not.toBe('"a"');
  });

  it("真支就是 infer 变量时仍走 α 捷径（inferFrom 在位）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const rel = getFnImpl(env.globals.b823b!)?.relation;
    expect(rel?.inferFrom?.via).toBe("arr");
    expect(rel?.inferFrom?.inferVar).toBe("E");
    // 反向：不得被当成「真支是别的东西」而丢掉元数据
    expect(rel?.inferFrom).toBeDefined();
  });

  it("嵌套真支不被当成 infer 变量 ⇒ 不挂 inferFrom", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    const rel = getFnImpl(env.globals.b823!)?.relation;
    // 真支不是 infer 变量 ⇒ 不该走 α 捷径（元数据不该被写上去）
    expect(rel?.inferFrom).toBeUndefined();
  });
});
