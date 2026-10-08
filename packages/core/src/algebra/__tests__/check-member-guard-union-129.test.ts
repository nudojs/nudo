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
 *
 * 评审加固：缺席槽 ≠ 读 undefined——分类与 $get 的 obj 缺席分支同口径
 * （containers.ts）：open/index 签名（读 unknown）、Object.prototype 方
 * 法名与 constructor（原型链读出函数，真值守卫必过）、accessorTable
 * getter（读 getter 结果，真值性不可判）→ 保守保留；refine 重建产生新
 * Abs 身份时迁移 accessor/propFlags/nullProto 侧表。
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
import { $objAccessor } from "../exec/runtime/members.ts";
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

describe("#129 评审加固：缺席槽 ≠ 读 undefined（$get 同口径）", () => {
  it("toString 守卫键不剪闭缺席臂：原型链读出函数，签名保留 string", () => {
    const sidecar = `
import { string, shape, union } from "@nudojs/core";
export const nodeParam = union(
  shape({ a: string() }),
  shape({ toString: string() }),
);
`;
    const r = check(`${CONTRACT}
export function g(node) {
  if (!node) return null;
  if (!node.toString) return null;
  return node.a;
}
`, sidecar);
    // {a: string} 臂 toString 缺席但原型链读出函数 → 守卫必过 → 臂保留；
    // 修复前剪臂致 node.a 只剩 undefined（签名丢 string）。display 为返回段
    expect(l2Count(r, "g")).toBe(0);
    expect(sigOf(r, "g")).toMatch(/string/);
    expect(sigOf(r, "g")).not.toMatch(/throws/);
  });

  it("getter-only 臂在成员真值守卫下保留：链式读 0 L2、签名含 7", () => {
    const r = check(`
export function g2(flag) {
  const o = flag ? { a: 1 } : { get p() { return { z: 7 }; } };
  if (!o) return null;
  if (!o.p) return null;
  return o.p.z;
}
`);
    // getter 臂 p 槽是 undefined-lit 占位（读走 accessorTable getter → {z:7}，
    // 真值必过守卫）→ 保留；{a:1} 臂 p 缺席闭无访问器 → 剪除塌缩 → o.p.z
    // = 7 零 L2。修复前 getter 臂按占位槽值剪除 → 全剪透传 → 假 may-throw
    expect(l2Count(r, "g2")).toBe(0);
    expect(sigOf(r, "g2")).toMatch(/7/);
    expect(sigOf(r, "g2")).not.toMatch(/throws/);
  });

  it("refine 重建迁移访问器侧表：data+getter 混合臂守卫后 getter 读不丢", () => {
    const r = check(`
export function g3(flag) {
  const o = flag
    ? { p: flag ? null : "s", get q() { return { z: 7 }; } }
    : { p: "x", q: 0, r: 1 };
  if (!o.p) return null;
  return o.q.z;
}
`);
    // 两臂槽键集不同（{p,q} vs {p,q,r}）→ sum 保持成员身份。混合臂 p 槽
    // refine（剥 null）重建新 Abs 身份——不迁移 accessorTable 则 q 的
    // getter 丢失（占位 undefined）→ o.q 撞 undefined 记假 may-throw；
    // 迁移后 o.q = {z:7} | 0（Number 接收者读 .z 不抛）→ 零 L2
    expect(l2Count(r, "g3")).toBe(0);
    expect(sigOf(r, "g3")).toMatch(/7/);
    expect(sigOf(r, "g3")).not.toMatch(/throws/);
  });

  it("proto 方法名 / constructor 缺席键不剪闭缺席臂（单元）", () => {
    const u = constraintToEntryAbs(
      derefConstraint(union(shape({ a: string() }), shape({ b: string() })) as never),
      "x",
    ) as never;
    // 两臂键均缺席——原型链读出函数（守卫必过）→ 全保留，原样返回（对象同一性）
    expect($removeMemberNullish(u, "toString")).toBe(u);
    expect($removeMemberNullish(u, "constructor")).toBe(u);
  });

  it("accessorTable getter 缺席键保守保留（单元）", () => {
    const accArm = constraintToEntryAbs(derefConstraint(shape({ tag: string() }) as never), "x") as never;
    const zVal = constraintToEntryAbs(derefConstraint(shape({ z: lit(7) }) as never), "z") as never;
    $objAccessor(accArm, "p", () => zVal, null);
    const dropArm = constraintToEntryAbs(derefConstraint(shape({ drop: string() }) as never), "x") as never;
    const s = abs({ k: "sum", members: [accArm, dropArm] }, undefined, undefined, "exact");
    // getter 臂 p 读 getter 结果（真值性不可判）→ 保留；无访问器臂 p 缺席闭
    // → 剪除 → 单成员塌缩为 getter 臂（槽键可区分两臂）
    const out = $removeMemberNullish(s, "p");
    expect(asShape(out).k).toBe("obj");
    expect(Object.keys(asShape(out).slots!)).toEqual(["tag"]);
  });

  it("getter 占位槽（undefined-lit 槽值）不剪（单元）", () => {
    const plainArm = constraintToEntryAbs(derefConstraint(shape({ keep: string() }) as never), "x") as never;
    const getterArm = constraintToEntryAbs(derefConstraint(shape({ drop: string() }) as never), "x") as never;
    const zVal = constraintToEntryAbs(derefConstraint(shape({ z: lit(7) }) as never), "z") as never;
    // 覆写 p 槽为 undefined-lit 占位（字面量 getter 的发射形态）
    const placeholder = {
      ...(getterArm as Record<string, unknown>),
      shape: {
        ...asShape(getterArm),
        slots: { ...asShape(getterArm).slots!, p: { value: abs({ k: "unknown" }, litTerm(undefined), pTrue, "exact") } },
      },
    } as never;
    // 注册必须挂在最终 Abs 身份上（accessorTable 按对象身份键控）
    $objAccessor(placeholder, "p", () => zVal, null);
    const s = abs({ k: "sum", members: [plainArm, placeholder] }, undefined, undefined, "exact");
    // getter 臂 p 槽值虽 undefined-lit，但读走 getter → 保留（含占位槽，
    // keep 语义 = 成员原样）；plain 臂 p 缺席闭 → 剪除塌缩为 getter 臂
    const out = $removeMemberNullish(s, "p");
    expect(asShape(out).k).toBe("obj");
    expect(Object.keys(asShape(out).slots!)).toEqual(["drop", "p"]);
  });

  it("index 签名缺席键保守保留（单元）", () => {
    const base = constraintToEntryAbs(derefConstraint(shape({ a: string() }) as never), "x") as never;
    const kVal = constraintToEntryAbs(derefConstraint(string() as never), "k") as never;
    const idxMember = {
      ...(base as Record<string, unknown>),
      shape: { ...asShape(base), index: { key: kVal, value: kVal } },
    } as never;
    const dropArm = constraintToEntryAbs(derefConstraint(shape({ c: string() }) as never), "x") as never;
    const s = abs({ k: "sum", members: [idxMember, dropArm] }, undefined, undefined, "exact");
    // index 签名臂 b 缺席读不可判 → 保留；闭无签名臂 b 缺席 → 剪除 → 塌缩
    const out = $removeMemberNullish(s, "b");
    expect(asShape(out).k).toBe("obj");
    expect(Object.keys(asShape(out).slots!)).toEqual(["a"]);
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
