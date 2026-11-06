/**
 * BUG-184 —— `@nudo:replace` 的目标文本命中**绑定位 / 对象属性键位**（非表达式位）
 * ⇒ 收集面算「命中」，转译面却只在**表达式发射入口**调用
 * `matchReplacement` ⇒ 指令**静默失效且零诊断**（引擎自己的「matched no
 * expression」告警被绕过）。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `replaceCandidateRanges`
 * 遍历整棵子树，把任何归一化文本等于 target 的节点都收成候选——不区分节点
 * 所在的**槽位**（`VariableDeclarator.id` / `ObjectProperty.key` / 形参 /
 * 非计算成员名 都不是值位）。
 *
 * 修法：收集面加**值位 + 表达式节点**过滤（与转译面同口径）⇒ 非表达式位
 * 的命中不再算命中 ⇒ 落到「未命中」诊断（可见）。
 *
 * 断言非永真：改前 `DECL_ID` / `OBJ_KEY` 的指令诊断数为 **0**；改后各 1 条
 * `nudo:directive-syntax`，而表达式位对照组（`OBJ_VAL`）零诊断且替换生效。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "@nudojs/core";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements, resolveEvalInjection } from "../eval-injection.ts";

/** 目标 `x` 命中的是声明符的 **id**（绑定名） */
const DECL_ID = `// @nudo:replace x number()
const x = 5;
export function getDeclId() { return x; }
`;

/** 目标 `a` 命中的是对象属性的**键** */
const OBJ_KEY = `// @nudo:replace a number()
const o = { a: 1 };
export function getObjKey() { return o.a; }
`;

/** 对照组：目标 `1` 命中的是属性**值**（表达式位）⇒ 必须生效 */
const OBJ_VAL = `// @nudo:replace 1 number()
const o = { a: 1 };
export function getObjVal() { return o.a; }
`;

/** 对照组：目标全文没有 ⇒ 必须告警 */
const NO_MATCH = `// @nudo:replace zzz number()
const x = 5;
export function getNoMatch() { return x; }
`;

function directiveDiagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags.filter((d) => d.code === "nudo:directive-syntax");
}

function signatureOf(src: string, name: string): string {
  const inject = resolveEvalInjection(src);
  const report = checkSource("/tmp/bug-184.js", src, undefined, {
    fromFile: "/tmp/bug-184.js",
    ...(inject ? { inject } : {}),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return sig!.display;
}

/** 未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd） */
function registeredOffsets(src: string): Array<number | undefined> {
  return collectEvalReplacements(src).targets.map((t) => t.stmtStart);
}

describe("BUG-184 — @nudo:replace 只认值位的表达式节点", () => {
  it("目标命中声明符 id（绑定位）⇒ 不算命中 + 显式诊断", () => {
    expect(registeredOffsets(DECL_ID)).toEqual([undefined]);
    const diags = directiveDiagsOf(DECL_ID);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "x"');
    expect(diags[0]!.message).toContain("matched no expression");
    // 绑定位没有被替换（值仍是 5），且这条「没生效」是**可见**的
    expect(signatureOf(DECL_ID, "getDeclId")).toBe("5");
  });

  it("目标命中对象属性键位 ⇒ 不算命中 + 显式诊断", () => {
    expect(registeredOffsets(OBJ_KEY)).toEqual([undefined]);
    const diags = directiveDiagsOf(OBJ_KEY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "a"');
  });

  it("对照组：目标命中属性值（表达式位）⇒ 命中有区间、零诊断、替换生效", () => {
    expect(typeof registeredOffsets(OBJ_VAL)[0]).toBe("number");
    expect(directiveDiagsOf(OBJ_VAL)).toEqual([]);
    expect(signatureOf(OBJ_VAL, "getObjVal")).toBe("number");
  });

  it("对照组：目标全文未命中 ⇒ 仍然是「matched no expression」告警", () => {
    const diags = directiveDiagsOf(NO_MATCH);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "zzz"');
  });
});
