/**
 * 分册 03 · Bug 78 —— `union()` / `nullable()` 成员的 `.int()` 在调用点
 * 零执法（假绿；同一契约在返回位与 guard / zod / standard 三面都判违例）。
 *
 * 根因：`.int()` 是**数据标志**（不带 pred），`instantiateOnTerm` 只补
 * typeof / preds ⇒ int 义务不在 `or` 谓词里；`checkUnionMembers` 只挑
 * `fields || element` 成员 ⇒ 消费侧也没人接。
 *
 * 修法：消费侧 `checkUnionIntObligation` 补这条义务（不改谓词代数——
 * 把 int 折进 `or` 成员会变成 `and`，反而把整条 union 压成未决）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, string, union, nullable } from "@nudojs/core";
export const intOrStr = union(number().int(), string());
export const maybeInt = nullable(number().int());
export const plainInt = number().int();
`;
const IMP = `/// @nudo:import { intOrStr, maybeInt, plainInt } from "./std78.nudo.js"\n`;
const FILE = "/t/bug78.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std78", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 78 · union / nullable 成员的 int 义务", () => {
  it.each([
    ["intOrStr", "union(number().int(), string())"],
    ["maybeInt", "nullable(number().int())"],
    ["plainInt", "非 union 对照 number().int()"],
  ])("%s 收到 1.5 ⇒ 报 x is int", (contract, _label) => {
    const v = violations(check(contract, "1.5"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x is int");
  });

  it.each([
    ["intOrStr", "2"],
    ["intOrStr", '"a"'],
    ["maybeInt", "null"],
    ["maybeInt", "undefined"],
  ])("负控制：%s 收到满足某一支的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
});
