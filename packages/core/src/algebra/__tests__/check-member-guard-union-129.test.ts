/**
 * 成员真值守卫事实传播到 union 容器成员剪影（issue #129）。
 *
 * 判别窄化（#126）后宽容尾臂在场时链式读 `node.property.type` 保守记
 * may-throw（尾臂槽缺席 → undefined → 域内确有该值，诚实残差）。但源码
 * 写了中间槽守卫 `if (!node.property) return null` 后，守卫事实应传播到
 * 后续对同一路径的重读：真值臂内槽确定 nullish 的 union 成员（闭 shape
 * 槽缺席读 undefined / 槽值整体 nullish）必走早退 → 剪除。
 *
 * 根因：#118 的 $removeMemberNullish 只重建 obj 槽（optional 摘除 + 槽值
 * 剥 nullish），sum 容器直接透传——判别窄化后 node 是
 * [MemberExpression 臂, 尾臂] sum，尾臂 property 槽缺席不可剪，链式读仍
 * 撞 undefined 记假 may-throw。修复：sum 分支按成员分类——缺席槽（闭）/ 确
 * 定 nullish 槽值 → 剪成员；`T | nullish` 槽值 / optional → obj 分支同款
 * 重建；open 缺席 / any / unknown / 非对象成员 → 保守保留；全剪空原样；
 * 单成员剪余塌缩（与 $removeNullish / $narrowMemberEq 同口径）。
 *
 * 控制组（诚实残差）：无守卫链式读仍 1 条 L2（may 态语义正确——尾臂与
 * lit 判别值域重叠，等价 TS 行为）；falsy 臂读不剪（property falsy 仍可
 * 能是 undefined）仍报。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  string,
  boolean,
  shape,
  union,
  nullable,
  litC as lit,
  lazy,
  formatAbs,
  constraintToEntryAbs,
  derefConstraint,
} from "@nudojs/core";
import { $removeMemberNullish, $removeNullish } from "../exec/runtime/async.ts";
import { abs } from "../abs.ts";
import { lit as litTerm } from "../term.ts";

/** issue 原文侧车：判别联合 + lazy 自引用 + string() 宽容尾臂 */
const ISSUE_SRC = `
import { string, boolean, shape, union, lit, nullable, lazy } from "@nudojs/core";
export const astNode = union(
  shape({ type: lit('Identifier'), name: string() }),
  shape({ type: lit('MemberExpression'), computed: boolean(), object: lazy(() => astNode), property: lazy(() => astNode) }),
  shape({ type: string() }),
);
export const nodeParam = nullable(astNode);
`;

const IMP = `/// @nudo:import { nodeParam } from "./std129.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std129") ? ISSUE_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string, sidecar: string = ISSUE_SRC) {
  return checkSource("/t/member-guard-union-129.js", IMP + src, pTrue, {
    ...opts,
    loadModule: (spec: string) => (spec.includes("std129") ? sidecar : undefined),
  });
}

/** L2 entry-may-throw 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

const CONTRACT = `/**
 * @nudo:contract node nodeParam
 */
`;

describe("#129 成员真值守卫：union 成员剪影后链式读零 L2", () => {
  it("issue 原型 sn4：判别窄化 + property 守卫 + 链式读 0 L2", () => {
    const r = check(`${CONTRACT}
export function sn4(node) {
  if (!node) return null;
  if (node.type === 'MemberExpression') {
    if (node.computed) return null;
    if (!node.property) return null;
    return node.property.type === 'Identifier' ? 'P' : null;
  }
  return null;
}`);
    expect(l2Count(r, "sn4")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "sn4")).toMatch(/"P"/);
    expect(sigOf(r, "sn4")).not.toMatch(/throws/);
  });

  it("无判别守卫直取：property 守卫独立剪影（Identifier/尾臂/null 全剪）0 L2", () => {
    const r = check(`${CONTRACT}
export function directGuard(node) {
  if (!node) return null;
  if (!node.property) return null;
  return node.property.type === 'Identifier' ? 'P' : null;
}`);
    expect(l2Count(r, "directGuard")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("变量守卫形态（issue 未测行）：const p = node.property 基线不回归", () => {
    const r = check(`${CONTRACT}
export function varGuard(node) {
  if (!node) return null;
  const p = node.property;
  if (!p) return null;
  return p.type === 'Identifier' ? 'P' : null;
}`);
    expect(l2Count(r, "varGuard")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });
});

describe("#129 控制组：守卫缺失的诚实残差仍报", () => {
  it("无守卫链式读：尾臂 property 槽缺席 → 恰好 1 条 L2（may 态保守）", () => {
    const r = check(`${CONTRACT}
export function noGuard(node) {
  if (!node) return null;
  if (node.type === 'MemberExpression') {
    if (node.computed) return null;
    return node.property.type === 'Identifier' ? 'P' : null;
  }
  return null;
}`);
    expect(l2Count(r, "noGuard")).toBe(1);
    expect(r.summary.errors).toBe(1);
  });

  it("falsy 臂读不剪：if (node.property) return 后 property 仍可能 undefined → 仍报", () => {
    const r = check(`${CONTRACT}
export function falsyArm(node) {
  if (!node) return null;
  if (node.property) return null;
  return node.property.type;
}`);
    expect(l2Count(r, "falsyArm")).toBeGreaterThanOrEqual(1);
  });
});


/** 测试内省用最小形态视图 */
type AnyAbs = {
  shape: { k: string; open?: boolean; slots?: Record<string, { value: unknown; optional?: boolean }>; members?: AnyAbs[] };
};
const asShape = (a: unknown): AnyAbs["shape"] => (a as { shape: AnyAbs["shape"] }).shape;

describe("#129 运行时单元：$removeMemberNullish sum 分支", () => {
  it("剪缺席槽闭成员，单成员塌缩，发射序 $removeNullish 先行", () => {
    const asUnion = union(
      shape({ type: lit("Identifier"), name: string() }),
      shape({
        type: lit("MemberExpression"),
        computed: boolean(),
        property: lazy(() => asUnion),
      }),
      shape({ type: string() }),
    );
    const node = constraintToEntryAbs(derefConstraint(nullable(asUnion) as never), "node") as never;
    // 发射形态同 nullishRemoveCallOf：$removeNullish 先剥 null-lit 成员
    const fact = $removeMemberNullish($removeNullish(node), "property");
    // Identifier 臂（property 缺席闭槽 → 读 undefined）与尾臂（同）剪除；
    // MemberExpression 臂（property: astNode 非 nullish）保留 → 单成员塌缩
    // （嵌套 property 槽值内的 name 属 lazy 展开值域，非顶层臂——查顶层键）
    expect(asShape(fact).k).toBe("obj");
    expect(Object.keys(asShape(fact).slots!)).toContain("computed");
    expect(Object.prototype.hasOwnProperty.call(asShape(fact).slots!, "name")).toBe(false);
  });

  it("槽值 T | nullish 剥 nullish 成员 + optional 摘除（obj 分支同款下沉到成员）", () => {
    const asUnion = union(
      shape({ p: nullable(string()), tag: lit("a") }),
      shape({ p: string().optional(), other: string() }),
    );
    const x = constraintToEntryAbs(derefConstraint(asUnion as never), "x") as never;
    const out = $removeMemberNullish(x, "p");
    const sh = asShape(out);
    expect(sh.k).toBe("sum");
    expect(sh.members!.length).toBe(2);
    for (const m of sh.members!) {
      expect(m.shape.slots!.p!.optional).toBeUndefined();
    }
    // 剥离后槽值不再含 null
    expect(formatAbs(out)).not.toContain("null");
  });

  it("槽值整体 nullish 的成员剪除（真值臂必走早退）", () => {
    // 文法无原生 null 字面量槽——手工构造 null-lit 槽值（term 判定面）
    const dropArm = constraintToEntryAbs(
      derefConstraint(shape({ p: string(), tag: lit("drop") }) as never),
      "x",
    ) as never;
    const nullLitVal = abs({ k: "unknown" }, litTerm(null), pTrue, "exact");
    const dropMember = {
      ...(dropArm as Record<string, unknown>),
      shape: { ...asShape(dropArm), slots: { ...asShape(dropArm).slots!, p: { value: nullLitVal } } },
    } as never;
    const keepArm = constraintToEntryAbs(
      derefConstraint(shape({ p: string(), tag: lit("keep") }) as never),
      "x",
    ) as never;
    const s = abs(
      { k: "sum", members: [keepArm, dropMember] },
      undefined,
      undefined,
      "exact",
    );
    const out = $removeMemberNullish(s, "p");
    // drop 臂剪除 → 单成员塌缩（entry 位 lit 宽化为 prim，按结构断言）
    const sh = asShape(out);
    expect(sh.k).toBe("obj");
    expect(Object.keys(sh.slots!)).toEqual(["p", "tag"]);
  });

  it("open 缺席槽保守保留；无可剪成员原样返回（对象同一性）", () => {
    const closed = constraintToEntryAbs(derefConstraint(shape({ a: string() }) as never), "x") as never;
    const openMember = {
      ...(closed as Record<string, unknown>),
      shape: { ...asShape(closed), open: true },
    } as never;
    const s = constraintToEntryAbs(
      derefConstraint(union(shape({ type: string() }), shape({ b: string() })) as never),
      "x",
    ) as never;
    const withOpen = {
      ...(s as Record<string, unknown>),
      shape: { ...asShape(s), members: [openMember, ...asShape(s).members!] },
    } as never;
    // open 成员缺席键读 unknown → 不可判保留；type 臂缺席闭槽剪除；b 臂保留
    const kept = $removeMemberNullish(withOpen, "b");
    expect(asShape(kept).members!.length).toBe(2);
    // 全员槽在场且非 nullish → 原样返回
    const allKept = constraintToEntryAbs(
      derefConstraint(union(shape({ b: lit("x") }), shape({ b: lit(1) })) as never),
      "x",
    ) as never;
    expect($removeMemberNullish(allKept, "b")).toBe(allKept);
  });
});
