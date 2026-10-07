/**
 * lazy(() => tpl) 自引用约束模板端到端（issue #120，checkSource 集成）。
 *
 * 侧车 astNode/staticName 即 issue #120 原文（object/property/callee/
 * arguments 自引用 + staticName 契约）。绑定走 @nudo:contract 指令
 * （check-guard-narrow-fp-118.test.ts 同款 harness；@nudo:import 引入的
 * fn 导出走的是模板通道，对 nullable 参数的 L2 语义弱于指令绑定——与本
 * 特性无关）。三条用例：
 *   (a) issue 原型 staticName（守卫递归折叠点号链）——其复合守卫
 *       `node.object == null || node.property == null` 的多名收窄依赖
 *       transpile 层（stmt-predicates.ts nullishGuardsOf，issue #118 v3 /
 *       #120 形态）由并行分支落地；已验证残余 L2 与 lazy 无关（手写两层
 *       模板同形态在 HEAD 同样报，probe 对照）。落地后断言翻回 TODO 处；
 *   (b) 定深路径精度：逐层 `== null` 单级守卫 + 局部重绑定，读
 *       node.object.object.type → 返回 null | string（精确，非 any）；
 *   (c) 深度边界：第 4 层 object 链（entry Abs 预算 LAZY_TEMPLATE_DEPTH=3
 *       展开 3 层 + 顶层）之后 lazy 字段为**缺席槽**——读取折叠为
 *       undefined，守卫剪枝干净；最深处再读属性是诚实的预算边界
 *       （depth cutoff boundary），不产生 constraint-violated / 崩溃。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

/** issue #120 侧车原文（astNode/staticName 逐字）；nodeParam/strOrNull 为指令绑定用的测试专用模板 */
const NUDO_SRC = `
import { shape, string, boolean, array, nullable, fn, lazy } from "@nudojs/core";
export const astNode = shape({
  type: string(),
  name: string().optional(),
  computed: boolean().optional(),
  object: lazy(() => astNode).optional(),
  property: lazy(() => astNode).optional(),
  callee: lazy(() => astNode).optional(),
  arguments: array(lazy(() => astNode)).optional(),
});
export const staticName = fn({ node: nullable(astNode) }, nullable(string()));
// ↓ 测试专用：@nudo:contract 指令按名绑定（模板形态，非 fn 绑定）
export const nodeParam = nullable(astNode);
export const strOrNull = nullable(string());
`;

const IMP = `/// @nudo:import { nodeParam, strOrNull } from "./std120.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std120") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/lazy-recursive-120.js", IMP + src, pTrue, opts);
}

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

describe("#120 lazy 递归模板：issue 原型 staticName", () => {
  it("(a) 守卫递归：0 L2 / 0 错误 / 返回契约可证（issue #120 原型清零）", () => {
    const r = check(`
/**
 * @nudo:contract node nodeParam
 * @nudo:contract return strOrNull
 */
export function staticName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    if (node.computed) return null;
    if (node.object == null || node.property == null) return null;
    const obj = staticName(node.object);
    if (obj == null) return null;
    const prop = staticName(node.property);
    return prop == null ? obj : obj + '.' + prop;
  }
  return null;
}
`);
    // 复合守卫（obj == null || node.property == null）多名剪影 +
    // $copy obj 副本保 term（递归指纹不坍缩 → 父子帧不误判 cycle）落地后，
    // issue #120 原型静态清零：
    expect(l2Count(r, "staticName")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "staticName")).toMatch(/string/);
    expect(sigOf(r, "staticName")).not.toMatch(/throws/);
    // lazy 自身的守卫独立面：
    // 契约零违约（L1）——lazy 展开的域判定不误报
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
    // 递归剪枝干净：自递归预算截断只发 info（不伪装成功、不红）
    expect(
      r.issues.some((i) => i.code === "nudo:recursion-truncated" && i.severity === "info"),
    ).toBe(true);
  });
});

describe("#120 lazy 递归模板：定深路径精度", () => {
  it("(b) 逐层单级守卫 + 局部重绑定：node.object.object.type → null | string", () => {
    const r = check(`
/**
 * @nudo:contract node nodeParam
 * @nudo:contract return strOrNull
 */
export function deepType(node) {
  if (node == null) return null;
  const inner = node.object;
  if (inner == null) return null;
  const deep = inner.object;
  if (deep == null) return null;
  return deep.type;
}
`);
    expect(l2Count(r, "deepType")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 精确返回域：null | string（非 any / unknown）
    expect(sigOf(r, "deepType")).toMatch(/^null \| string\b/);
  });
});

describe("#120 lazy 递归模板：深度边界", () => {
  it("(c) 第 4 层 object 链不崩溃、无 constraint-violated（缺席槽守卫剪枝干净）", () => {
    const r = check(`
/**
 * @nudo:contract x nodeParam
 * @nudo:contract return strOrNull
 */
export function deep4(x) {
  if (x == null) return null;
  const a = x.object;
  if (a == null) return null;
  const b = a.object;
  if (b == null) return null;
  const c = b.object;
  if (c == null) return null;
  return c.object.type;
}
`);
    // 预算边界（depth cutoff boundary）：entry Abs 展开 x.object.object.object
    // （顶层 + 3 层 lazy）后，再往下的 lazy 字段是缺席槽——c.object 读出
    // undefined，`.type` 撞 undefined 是诚实的预算边界 L2（非崩溃、非契约违约）。
    expect(l2Count(r, "deep4")).toBe(1);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
    expect(r.summary.errors).toBe(1); // 上述 L2
  });
});
