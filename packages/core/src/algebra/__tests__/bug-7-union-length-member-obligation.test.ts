/**
 * 分册 03 · Bug 7 —— `union()` 里只要有一个**长度界 / 结构**成员，整条析取
 * 契约在调用点零义务（假绿）。
 *
 * 根因：`string().min(1)` 实例化成 `ge(length(x), 1)`，根在 app 不在 var ⇒
 * `predOnVar` 判 false ⇒ `orMembersOnVar` 把 `judgeOrUnion` 的整段域兼容
 * 兜底关掉；`memberDomainKind` 也判不出长度界 ⇒ 全部成员落「未决」⇒ 不报。
 * `checkUnionMembers` 只接管形态命中的结构成员 ⇒ 标量实参落回静默通道。
 *
 * 修法：`predOnVar` 把长度界 / 字段界（非结构成员）也算「挂在参数自身」，
 * 并新增 `memberImpossible`（形态级确定假）⇒ 域兜底对这三类成员生效。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, string, shape, union } from "@nudojs/core";
export const numOrStr = union(number().gt(0), string().min(1));
export const shapeOrNum = union(shape({ id: number().gt(0) }), number().gt(0));
export const numOrStrNoLen = union(number().gt(0), string());
`;
const IMP = `/// @nudo:import { numOrStr, shapeOrNum, numOrStrNoLen } from "./std7.nudo.js"\n`;
const FILE = "/t/bug7.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std7", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 7 · 含长度界成员的 union 对确定违例必须执法", () => {
  it.each(["0", "true", "{}", "null", '""'])(
    "numOrStr（number().gt(0) | string().min(1)）收到 %s ⇒ 1 条违例",
    (arg) => {
      expect(violations(check("numOrStr", arg))).toHaveLength(1);
    },
  );

  it.each(['5', '"hi"'])(
    "负控制：numOrStr 收到满足某一支的 %s ⇒ 零违例",
    (arg) => {
      expect(violations(check("numOrStr", arg))).toHaveLength(0);
    },
  );
});

describe("Bug 7 · 含结构成员的 union 对域不兼容实参必须执法", () => {
  it.each(['"z"', "true", "null", "[1]"])(
    "shapeOrNum 收到 %s ⇒ 1 条违例",
    (arg) => {
      expect(violations(check("shapeOrNum", arg))).toHaveLength(1);
    },
  );

  it.each(["{ id: 1 }", "5"])(
    "负控制：shapeOrNum 收到满足某一支的 %s ⇒ 零违例",
    (arg) => {
      expect(violations(check("shapeOrNum", arg))).toHaveLength(0);
    },
  );
});

describe("Bug 7 · 对照组（无长度界的 union）不回归", () => {
  it.each(["0", "{}"])("numOrStrNoLen 收到 %s ⇒ 仍报 1 条", (arg) => {
    expect(violations(check("numOrStrNoLen", arg))).toHaveLength(1);
  });
});
