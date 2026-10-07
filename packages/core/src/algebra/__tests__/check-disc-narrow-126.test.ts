/**
 * 判别等值守卫臂剪影（issue #126）：`x.key === 'lit'`（`!==` 对偶）事实臂内
 * union 参数剪除判别值域不含该字面量的成员——kind-specific 字段的 index 读
 * （`node.quasis[0]`）不再撞其他臂的 undefined 记假 may-throw。
 *
 * 三态成员分类（$narrowMemberEq / memberEqClass）：
 * - "only"（槽值域恰为 lit，pred ⊢ eq）→ 对偶补集臂剪除；
 * - "never"（值域排除 lit / 形态不容 / 闭 shape 槽缺席 / nullish-lit 成员）
 *   → 事实臂剪除；
 * - "may"（typeof-only 域、any/unknown 令牌）→ 双侧保守保留。
 *
 * 边界（诚实残差，文档化）：宽容尾臂 `shape({ type: string() })` 的值域
 * **含**判别字面量（string ⊇ 'TemplateLiteral'）→ 事实臂保守保留，其上
 * 未声明的 index 读字段仍记 1 条 L2——param 值域确实接纳无该字段的值
 * （{type:'TemplateLiteral'} 无 quasis 落尾臂，`quasis[0]` 原生必抛）。
 * TS 同形窄化保留 {type:string} 臂并对其报属性缺失——nudo 的对应物即这条
 * 诚实 may-throw。属性读（宽容）不受影响。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, string, shape, union, litC as lit, nullable, array, formatAbs } from "@nudojs/core";
import { constraintToEntryAbs, derefConstraint, transpile } from "@nudojs/core";
import { $narrowMemberEq } from "../exec/runtime/async.ts";

/** 不相交判别联合（TS 判别联合正典形态：两 lit 臂，无 string() 尾臂） */
const DISJOINT_SRC = `
import { string, shape, union, lit, nullable, array } from "@nudojs/core";
const asUnion = union(
  shape({ type: lit('Identifier'), name: string() }),
  shape({ type: lit('TemplateLiteral'),
          expressions: array(shape({})),
          quasis: array(shape({ value: shape({ cooked: string().optional() }) })) }),
);
export const nodeParam = nullable(asUnion);
`;

/** issue 原文侧车：+ string() 宽容尾臂（值域与 lit 臂重叠） */
const CATCHALL_SRC = DISJOINT_SRC.replace(
  ");\nexport const nodeParam",
  "  shape({ type: string() }),\n);\nexport const nodeParam",
);

const IMP = `/// @nudo:import { nodeParam } from "./std126.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std126") ? DISJOINT_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string, sidecar: string = DISJOINT_SRC) {
  return checkSource("/t/disc-narrow-126.js", IMP + src, pTrue, {
    ...opts,
    loadModule: (spec: string) => (spec.includes("std126") ? sidecar : undefined),
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

describe("#126 判别等值守卫：issue 原文三形态（不相交判别联合 + nullable）", () => {
  it("三元：null 守卫后 index 读 0 L2、返回域精确", () => {
    const r = check(`${CONTRACT}
export function ternaryForm(node) {
  if (!node) return null;
  return node.type === 'TemplateLiteral' ? node.quasis[0] : null;
}`);
    expect(l2Count(r, "ternaryForm")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "ternaryForm")).toMatch(/\{ value: \{ cooked\?: string \} \}/);
  });

  it("if 简单形态：早退提升路径同样剪影", () => {
    const r = check(`${CONTRACT}
export function ifSimpleForm(node) {
  if (!node) return null;
  if (node.type === 'TemplateLiteral') {
    return node.quasis[0];
  }
  return null;
}`);
    expect(l2Count(r, "ifSimpleForm")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("if 复合形态（&& 判别 + 成员真值守卫齐用）", () => {
    const r = check(`${CONTRACT}
export function ifCompoundForm(node) {
  if (!node) return null;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0];
  }
  return null;
}`);
    expect(l2Count(r, "ifCompoundForm")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });
});

describe("#126 判别等值守卫：对偶与字面量位置", () => {
  it("!== 早退：穿透臂（eq 事实臂）内 index 读 0 L2", () => {
    const r = check(`${CONTRACT}
export function neqEarly(node) {
  if (!node) return null;
  if (node.type !== 'TemplateLiteral') return null;
  return node.quasis[0];
}`);
    expect(l2Count(r, "neqEarly")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("字面量在左对称识别：'TemplateLiteral' === node.type", () => {
    const r = check(`${CONTRACT}
export function litLeft(node) {
  if (!node) return null;
  return 'TemplateLiteral' === node.type ? node.quasis[0] : null;
}`);
    expect(l2Count(r, "litLeft")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("可选链判别 `node?.type === lit`：无 null 守卫也 0 L2（nullish-lit 成员按 never 剪除）", () => {
    const r = check(`${CONTRACT}
export function optChain(node) {
  return node?.type === 'TemplateLiteral' ? node.quasis[0] : null;
}`);
    expect(l2Count(r, "optChain")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("数字判别字面量：kind === 1 臂内读取 0 L2", () => {
    const numSrc = `
import { string, shape, union, lit, nullable } from "@nudojs/core";
export const nodeParam = nullable(union(
  shape({ kind: lit(1), payload: string() }),
  shape({ kind: lit(2) }),
));`;
    const r = check(`${CONTRACT}
export function numDisc(node) {
  if (!node) return null;
  return node.kind === 1 ? node.payload : null;
}`, numSrc);
    expect(l2Count(r, "numDisc")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("宽松 == 不识别（强制转换面，宁缺毋假）——不发射剪影", () => {
    const out = transpile(
      `export function looseEq(node) { return node.type == 'TemplateLiteral' ? node.quasis[0] : null; }`,
    );
    // import 行恒含运行时名——断言调用形态缺席
    expect(out).not.toContain("$narrowMemberEq(");
  });
});

describe("#126 宽容尾臂边界（重叠值域的诚实残差）", () => {
  it("string() 尾臂值域含判别字面量 → index 读保留恰好 1 条诚实 L2", () => {
    const r = check(`${CONTRACT}
export function catchallIdx(node) {
  if (!node) return null;
  return node.type === 'TemplateLiteral' ? node.quasis[0] : null;
}`, CATCHALL_SRC);
    expect(l2Count(r, "catchallIdx")).toBe(1);
    expect(r.summary.errors).toBe(1);
  });

  it("尾臂在场时属性读仍干净（宽容读不依赖窄化）", () => {
    const r = check(`${CONTRACT}
export function catchallProp(node) {
  if (!node) return null;
  return node.type === 'Identifier' ? node.name : null;
}`, CATCHALL_SRC);
    expect(l2Count(r, "catchallProp")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });
});

describe("#126 接线与运行时单元", () => {
  it("三元转译发射 $narrowMemberEq 影子重绑（事实臂 keep=true）", () => {
    const out = transpile(
      `export function g(node) { return node.type === 'TemplateLiteral' ? node.quasis[0] : null; }`,
    );
    expect(out).toContain('$narrowMemberEq(node, "type", "TemplateLiteral", true)');
  });

  it("$narrowMemberEq：事实臂剪 never、补集臂剪 only、单成员塌缩、非 sum 原样", () => {
    const asUnion = union(
      shape({ type: lit("Identifier"), name: string() }),
      shape({ type: lit("TemplateLiteral"), quasis: array(shape({})) }),
      shape({ type: string() }),
    );
    const node = constraintToEntryAbs(derefConstraint(nullable(asUnion) as never), "node") as never;
    const fact = $narrowMemberEq(node, "type", "TemplateLiteral", true);
    // Identifier 臂（eq 'Identifier' ≠ 'TL' → never）与 nullish-lit 成员剪除；
    // TL 臂（only）与 string() 尾臂（may）保留
    expect(formatAbs(fact)).toContain("quasis");
    expect(formatAbs(fact)).not.toContain("name");
    expect(formatAbs(fact)).not.toContain("null");
    const dual = $narrowMemberEq(node, "type", "TemplateLiteral", false);
    // 补集臂：TL 臂（only）剪除；Identifier（never→保留）与尾臂（may）与
    // nullish（never→保留）保留
    expect(formatAbs(dual)).toContain("name");
    expect(formatAbs(dual)).not.toContain("quasis");
    expect(formatAbs(dual)).toContain("null");
    // 单成员剪余直接返回该成员（脱离 sum 包装）
    const two = union(shape({ type: lit("A") }), shape({ type: lit("B") }));
    const twoAbs = constraintToEntryAbs(derefConstraint(two as never), "x") as never;
    const single = $narrowMemberEq(twoAbs, "type", "A", true);
    expect((single as never as { shape: { k: string } }).shape.k).toBe("obj");
    // 无可剪成员（补集臂全员保留 / 无判别事实命中）→ 原样返回（对象同一性）
    const noChange = $narrowMemberEq(node, "type", "A", false);
    expect(noChange).toBe(node);
    // 事实臂剪至尾臂单成员 → obj 塌缩（Identifier/TL/nullish 全 never）
    const collapsed = $narrowMemberEq(node, "type", "A", true);
    expect((collapsed as never as { shape: { k: string } }).shape.k).toBe("obj");
    // 非 sum 单形态原样返回
    const flat = constraintToEntryAbs(derefConstraint(shape({ type: string() }) as never), "x") as never;
    expect($narrowMemberEq(flat, "type", "A", true)).toBe(flat);
  });

  it("守卫名被臂内写（fork 绑定集）时跳过剪影——影子参数不得吞掉臂内写", () => {
    const out = transpile(
      `export function h(node) { if (node.type === 'TemplateLiteral') { node = node.quasis; return node[0]; } return null; }`,
    );
    expect(out).not.toContain("$narrowMemberEq(");
  });
});
