/**
 * BUG-013 —— `@nudo:replace` 的「紧随语句」是**裸块语句** `{ … }` 时，收集面
 * 的**作用域边界**守卫把 walk 的**根节点**也挡住了 ⇒ 候选区间恒空 ⇒
 * 替换**永不生效**，而诊断还谎称「该指令所标注语句的作用域内没有匹配表达式」
 * ——匹配目标就在它所标注的那个块里。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `replaceCandidateRanges`
 * 对 walk 的根也判 `SCOPE_BOUNDARY_TYPES`（含 `BlockStatement`）⇒ 第一步即
 * 返回。边界守卫的意图只是「不下钻**嵌套**作用域」。
 *
 * 断言非永真：改前 `blockTarget` 的签名是 `number | string` 且带一条
 * 「matched no expression」警告；改后是 `number` 且零该警告。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "@nudojs/core";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements, resolveEvalInjection } from "../eval-injection.ts";

/** 指令挂在**裸块语句**上（块内用的就是目标 `a`） */
const BLOCK_TARGET = `export function blockTarget(a) {
  // @nudo:replace a number()
  {
    const x = a + 1;
    return x;
  }
}
`;

/** 对照组：指令挂在普通语句（`const`）上——改前改后都生效 */
const CONST_TARGET = `export function plainTarget(a) {
  // @nudo:replace a number()
  const x = a + 1;
  return x;
}
`;

/** 目标**只**落在嵌套语句块里（真·边界挡住） */
const NESTED_BLOCK_TARGET = `export function nested(a) {
  // @nudo:replace b number()
  {
    const x = 1;
    {
      const b = 2;
      return b + x;
    }
  }
  return a;
}
`;

function diagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags.filter((d) => d.code === "nudo:directive-syntax");
}

/** 与 `nudo check` 同一注入管线：收集面 → transpile 注入包 → checkSource */
function signatureOf(src: string, name: string): { display: string; throws?: string } {
  const inject = resolveEvalInjection(src);
  const report = checkSource("/tmp/bug-013.js", src, undefined, {
    fromFile: "/tmp/bug-013.js",
    ...(inject ? { inject } : {}),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return { display: sig!.display, throws: sig!.throws };
}

describe("BUG-013 — @nudo:replace 挂在裸块语句上必须生效", () => {
  it("裸块语句上的指令登记了**节点身份**区间（改前恒空）", () => {
    const reps = collectEvalReplacements(BLOCK_TARGET);
    expect(reps.targets).toHaveLength(1);
    expect(typeof reps.targets[0]!.stmtStart).toBe("number");
    expect(typeof reps.targets[0]!.stmtEnd).toBe("number");
  });

  it("裸块语句 与 普通语句 的签名逐字相同（替换真的生效）", () => {
    expect(signatureOf(BLOCK_TARGET, "blockTarget").display).toBe("number");
    expect(signatureOf(BLOCK_TARGET, "blockTarget").display).toBe(
      signatureOf(CONST_TARGET, "plainTarget").display,
    );
  });

  it("裸块语句命中 ⇒ 零「未命中」诊断（不许谎报作用域内没有该表达式）", () => {
    expect(diagsOf(BLOCK_TARGET)).toEqual([]);
  });

  it("目标确实只在**嵌套**块里 ⇒ 诊断明说「被嵌套作用域挡住」而不是「没有该表达式」", () => {
    const diags = diagsOf(NESTED_BLOCK_TARGET);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("@nudo:replace target \"b\"");
    expect(diags[0]!.message).toContain("nested scope");
    expect(diags[0]!.message).not.toContain("matched no expression");
  });
});
