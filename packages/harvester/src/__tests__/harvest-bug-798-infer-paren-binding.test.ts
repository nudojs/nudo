/**
 * Bug 798 回归（harvester 收割面）：`matchExtendsInfer` **不认括号节点** ⇒
 * `(infer E)[]` 里的 `infer E` 外面套了一层 `ParenthesizedTypeNode` ⇒
 * 模式匹配落到兜底分支 ⇒ **E 不绑定** ⇒ 真支退化成 α 变量 ⇒
 * `number[] extends (infer E)[] ? E : never` 收割成 `any`（TS：`number`）。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   parenArr() => any      （TS：number）
 *   parenObj() => any      （TS：number）
 *   prom()     => number   （TS：number —— `Promise<infer U>` 无括号，能绑）
 * 改后：三条全是 number ⇒ 同一语义只差一层括号不再有别。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认定三条的真值都是 number。
 *
 * ⚠️ 勘误：`number[] extends infer E[] ? E : never`（**去掉**括号）在 TS 里是
 * **语法错误**（TS1005: '?' expected）⇒ 不能当「同一构造去掉括号就能绑」的
 * 对照组；能去括号的对照构造是 `Promise<infer U>`（本文件已含）。
 *
 * 契约（双向）：
 *   1. 括号必须**穿透**（`infer` 收集与模式匹配都要过括号）；
 *   2. 绑定值必须**替换**真支里的 infer 变量引用（真支 `E` 是 TypeReferenceNode，
 *      不是 InferTypeNode —— 不查绑定表就会退化成 α）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug798-"));
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
  `export declare function b798a(): number[] extends (infer E)[] ? E : never;`,
  `export declare function b798b(): { a: number } extends { a: infer V } ? V : never;`,
  `export declare function b798c(): Promise<number> extends Promise<infer U> ? U : never;`,
].join("\n");

describe("Bug 798 —— (infer E)[] 的括号穿透 + 绑定替换真支", () => {
  it("带括号的数组 infer 绑定元素类型（改前 any）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798a")).toBe("number");
    // 反向：不得退化成 α / unknown
    expect(retOf(env, "b798a")).not.toBe("any");
    expect(retOf(env, "b798a")).not.toBe("unknown");
  });

  it("带括号的类型字面量 infer 绑定成员类型（改前 any）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798b")).toBe("number");
    expect(retOf(env, "b798b")).not.toBe("any");
  });

  it("无括号的 Promise infer 仍然绑定（不被括号口径改坏）", () => {
    const p = writeTemp("a.d.ts", decls);
    const env = harvestDts([p]);
    expect(retOf(env, "b798c")).toBe("number");
    expect(retOf(env, "b798c")).not.toBe("any");
  });

  it("同一语义（带括号 / 不带括号）得到同一个值", () => {
    const p = writeTemp(
      "a.d.ts",
      `export declare function paren(): number[] extends (infer E)[] ? E : never;\n` +
        `export declare function generic(): number[] extends Array<infer F> ? F : never;\n`,
    );
    const env = harvestDts([p]);
    expect(retOf(env, "paren")).toBe("number");
    expect(retOf(env, "generic")).toBe("number");
    expect(retOf(env, "paren")).toBe(retOf(env, "generic"));
  });
});
