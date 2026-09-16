/**
 * 推导图（derivation trace）side-channel（design-refine-derivation §14.3#6 / §11 Phase 2）。
 *
 * 不叫 provenance：`setProvenanceTracking` 已被 evaluator 的 TypeValue origin map
 * 占用。机制对齐 `setCallCollector` / `setAbsTruncationCollector` 先例——
 * **不进 Abs payload**；ast-eval 与 B-path 共用 core ops（`add` / `joinAbs`），
 * 两条路径天然都覆盖。
 *
 * 设计原则：emit 打印的是推导图的投影，**禁止**事后从最终 Abs 反编译 shift 链。
 * 本模块在 ops 层打点：数值常量加法 → shift 边；joinAbs → join 边。
 * 根约束（手写契约参数）由宿主在入口 Abs 上打 root 标签。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Term } from "./term.ts";
import { termToString } from "./term.ts";

/** 推导节点：边带调用位点 / +k / join；root 携带可打印的约束源表达式 */
export type DerivationNode = {
  id: number;
  kind: "root" | "shift" | "join" | "opaque";
  /** root：宿主给的可读约束表达式（`positive` / `number().gt(0)`） */
  expr?: string;
  /** root：跨文件 import 源（相对 specifier，相对 root 侧车目录） */
  importFrom?: string;
  /** root：import 绑定名（与 expr 一致时省略） */
  importName?: string;
  /** shift：数值偏移 */
  offset?: number;
  /** 父节点 id（root 无父） */
  parents: number[];
};

/** 调用位点上的实参推导（供 emit 投影组合式） */
export type ArgDerivation = {
  node: DerivationNode;
  /** 从该节点回溯到 root 的路径（含自身，root 在末尾） */
  chain: DerivationNode[];
};

type Collector = (node: DerivationNode) => void;

let collector: Collector | null = null;
let nextId = 1;
/** Abs 对象身份 → 节点（求值期同一对象引用流经 add/join/call） */
const byAbs = new WeakMap<Abs, DerivationNode>();
/** 当前会话全部节点（id → node），end 时取走 */
let sessionNodes: Map<number, DerivationNode> | null = null;

/** 设置观察者（null 清除）；缓冲照常累积 */
export function setDerivationCollector(fn: Collector | null): void {
  collector = fn;
}

export function hasDerivationSession(): boolean {
  return sessionNodes !== null;
}

/** 开始一次推导会话（root 驱动下行求值前调用）；返回 end 用的 token */
export function beginDerivationSession(): void {
  sessionNodes = new Map();
  nextId = 1;
}

/** 结束会话并取走全部节点（顺序 = 创建序） */
export function endDerivationSession(): DerivationNode[] {
  const nodes = sessionNodes ? [...sessionNodes.values()] : [];
  sessionNodes = null;
  collector = null;
  return nodes;
}

/** 丢弃当前会话（求值失败时） */
export function abortDerivationSession(): void {
  sessionNodes = null;
  collector = null;
}

function note(node: Omit<DerivationNode, "id">): DerivationNode {
  const full: DerivationNode = { ...node, id: nextId++ };
  if (sessionNodes) sessionNodes.set(full.id, full);
  collector?.(full);
  return full;
}

/**
 * 在入口 Abs 上打 root 标签：该值来自手写契约参数约束。
 * expr 是可打印源（`positive`）；importFrom 指向共享模板侧车。
 */
export function tagDerivationRoot(
  abs: Abs,
  meta: { expr: string; importFrom?: string; importName?: string },
): DerivationNode {
  const node = note({
    kind: "root",
    expr: meta.expr,
    ...(meta.importFrom !== undefined ? { importFrom: meta.importFrom } : {}),
    ...(meta.importName !== undefined ? { importName: meta.importName } : {}),
    parents: [],
  });
  byAbs.set(abs, node);
  return node;
}

/** 读取 Abs 上的推导节点（无标签 → undefined） */
export function getDerivation(abs: Abs): DerivationNode | undefined {
  return byAbs.get(abs);
}

/** 手动把推导挂到结果 Abs（宿主在 analyzeFn 返回值上补标签时用） */
export function setDerivation(abs: Abs, node: DerivationNode): void {
  byAbs.set(abs, node);
}

/** 从节点回溯 root 路径（含自身；环/缺失截断） */
export function derivationChain(node: DerivationNode): DerivationNode[] {
  const chain: DerivationNode[] = [node];
  const seen = new Set<number>([node.id]);
  let cur = node;
  while (cur.kind !== "root" && cur.parents.length > 0) {
    const pid = cur.parents[0]!;
    if (seen.has(pid) || !sessionNodes) break;
    const parent = sessionNodes.get(pid);
    if (!parent) break;
    seen.add(pid);
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

/**
 * ops 层打点：`a + k`（k 为有限数值字面量）且 a 带推导 → 结果挂 shift 节点。
 * 由 arithmetic.add 在返回前调用；无会话/无父标签时 no-op。
 */
export function noteDerivationAdd(a: Abs, b: Abs, result: Abs): void {
  if (!sessionNodes) return;
  const vb = litValue(b);
  const va = litValue(a);
  let parent: DerivationNode | undefined;
  let offset: number | undefined;
  if (typeof vb === "number" && Number.isFinite(vb)) {
    parent = byAbs.get(a);
    offset = vb;
  } else if (typeof va === "number" && Number.isFinite(va)) {
    parent = byAbs.get(b);
    offset = va;
  }
  if (!parent || offset === undefined) return;
  const node = note({
    kind: "shift",
    offset,
    parents: [parent.id],
  });
  byAbs.set(result, node);
}

/**
 * ops 层打点：join 结果挂 join 节点（任一侧有推导即可）。
 * 工件聚合路径会经 join；check 分轨不依赖 join 节点。
 */
export function noteDerivationJoin(inputs: Abs[], result: Abs): void {
  if (!sessionNodes) return;
  const parents: number[] = [];
  for (const a of inputs) {
    const n = byAbs.get(a);
    if (n && !parents.includes(n.id)) parents.push(n.id);
  }
  if (parents.length === 0) return;
  const node = note({ kind: "join", parents });
  byAbs.set(result, node);
}

/**
 * 把推导链投影为组合式（§2.4：写组合式，不展开）。
 *
 * 返回 prelude（`const x = positive.shift(1);`）+ expr（`x` / `x.shift(2)`）
 * + 需要的 import。无 root 锚或链上出现 join/opaque → undefined（调用方
 * 退回展开式投影或 not-projectable）。
 */
export function projectDerivationDsl(
  node: DerivationNode,
  localName: string,
): {
  prelude: string[];
  expr: string;
  imports: Array<{ name: string; from: string }>;
} | undefined {
  const chain = derivationChain(node);
  const root = chain[chain.length - 1];
  if (!root || root.kind !== "root" || root.expr === undefined) return undefined;
  if (chain.some((n) => n.kind === "join" || n.kind === "opaque")) return undefined;

  // chain: [leaf … shift, root]；从 root 往 leaf 累积 shift
  const shifts: number[] = [];
  for (let i = chain.length - 2; i >= 0; i--) {
    const n = chain[i]!;
    if (n.kind !== "shift" || n.offset === undefined) return undefined;
    shifts.push(n.offset);
  }

  const rootExpr = root.expr;
  const imports: Array<{ name: string; from: string }> = [];
  if (root.importFrom !== undefined) {
    imports.push({
      name: root.importName ?? rootExpr,
      from: root.importFrom,
    });
  }

  if (shifts.length === 0) {
    return { prelude: [], expr: rootExpr, imports };
  }

  // 多步 shift：落地中间量，避免 positive.shift(1).shift(2) 加总成 shift(3)
  // （§2.4 链式，不加总——diff 反映关系变化）
  let current = rootExpr;
  const prelude: string[] = [];
  for (let i = 0; i < shifts.length; i++) {
    const step = `${current}.shift(${shifts[i]})`;
    if (i === shifts.length - 1) {
      // 最后一步：作为 local 绑定（与参数位共用时 emit 可直接引用）
      prelude.push(`const ${localName} = ${step};`);
      return { prelude, expr: localName, imports };
    }
    const tmp = `${localName}_${i}`;
    prelude.push(`const ${tmp} = ${step};`);
    current = tmp;
  }
  /* c8 ignore next */
  return undefined;
}

/** 项结构调试用（测试断言） */
export function termKey(t: Term | undefined): string {
  return t === undefined ? "<none>" : termToString(t);
}
