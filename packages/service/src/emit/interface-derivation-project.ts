/**
 * Derivation slot projection（Abs → 组合式 DSL 投影缝）。
 * 自 interface-derivation.ts 机械拆出；语义未改。
 *
 * 不变量（Invariants）：
 * - **推导标签必须在 join 之前读**：`joinAbs` / `makeSum` 可能**返回入参本身**
 *   （同形去重），`noteDerivationJoin` 按**对象身份**把 join 标签写到那个入参上
 *   ⇒ 第一个调用点的 shift 链被顶替 ⇒ 多调用点分支的组合式形态**永不可达**
 *   （Bug 988：同一函数的派生契约随 root 调用点个数漂移）。
 * - **返回位的相对锚定必须可判定**：同一 root 的多个形参**只按 root id 无法区分**
 *   （Bug 984：返回位张冠李戴 ⇒ 契约 unsound）⇒ 多候选时按**约束值**消歧；
 *   仍不唯一 ⇒ **拒绝**相对锚定（调用方退回直链投影），禁止张冠李戴。
 * - 多调用点只在**各调用点推导链一致**时走组合式：链不一致时各调用点的 prelude
 *   会给出**同名不同值**的 const（`const x = …shift(1)` 与 `const x = …shift(5)`）
 *   ⇒ 侧车成非法 ESM ⇒ 一律退回展开式。
 */
import { formatConstraint, joinThenProject, type Abs, type NudoConstraint } from "@nudojs/core";
import { derivationChain, getDerivation, projectDerivationDsl, type DerivationNode } from "@nudojs/core/internal";
import type { LoadModule } from "../load-module.ts";

export type ConstraintSourceExpr = {
  expr: string;
  importFrom?: string;
  importName?: string;
};

export type DerivedParam = {
  name: string;
  constraint: NudoConstraint;
  dsl: string;
  prelude: string[];
  imports: Array<{ name: string; from: string }>;
  /** 单链组合式投影时的推导图 root 节点 id（返回位相对锚定用） */
  rootNodeId?: number;
  /** 该参数位自 root 起消耗的 shift 步数（与 prelude 行数无关，读图） */
  shiftCount?: number;
};

export type DerivedExport = {
  file: string;
  fn: string;
  paramNames: string[];
  params: DerivedParam[];
  returns?: {
    constraint: NudoConstraint;
    dsl: string;
    prelude: string[];
    imports: Array<{ name: string; from: string }>;
  };
  /** `lib.js:add4` */
  derivedFrom: string;
  compositional: boolean;
  underivable?: boolean;
};

export type RootDeriveOpts = {
  loadModule?: LoadModule;
  autoBind?: boolean;
  fnNames?: string[];
  /**
   * true：只刷新目标侧车里**已存在**的 @generated 段（CLI 无 --fn/--all 时
   * 的默认行为——不发明新下游契约）。false/省略：闭包内全部可推导导出。
   */
  refreshExistingOnly?: boolean;
};

export type RootDeriveResult = {
  roots: string[];
  derived: DerivedExport[];
  hasRoot: boolean;
  /** 模块图求值失败（fail-closed，BUG-017 同径）：不推导、不带空 import 表继续 */
  graphError?: string;
};

export function projectParamSlot(
  absList: Abs[],
  paramName: string,
): {
  constraint: NudoConstraint;
  dsl: string;
  prelude: string[];
  imports: Array<{ name: string; from: string }>;
  compositional: boolean;
  rootNodeId?: number;
  shiftCount?: number;
} | undefined {
  if (absList.length === 0) return undefined;
  // 推导标签**先于 join**读取：joinAbs/makeSum 可能返回入参本身（同形去重），
  // noteDerivationJoin 按对象身份把 join 标签写到那个入参上 ⇒ 第一个调用点的
  // shift 链被顶替 ⇒ 组合式分支永不可达（Bug 988）。
  const nodes = absList.map((a) => getDerivation(a));
  const constraint = joinThenProject(absList);
  if (constraint === undefined) return undefined;

  if (absList.length === 1) {
    const node = nodes[0]!;
    if (node) {
      const proj = projectDerivationDsl(node, paramName);
      if (proj) {
        const chain = derivationChain(node);
        const root = chain[chain.length - 1];
        const shiftCount = chain.filter((n) => n.kind === "shift").length;
        return {
          constraint,
          dsl: proj.expr,
          prelude: proj.prelude,
          imports: proj.imports,
          compositional: true,
          ...(root?.kind === "root" ? { rootNodeId: root.id } : {}),
          shiftCount,
        };
      }
    }
  }
  // 多调用点（同一 root 的多个调用点）：各链均可组合式且同一 root → 保持组合式。
  // 链**不一致**时各调用点的 prelude 会给出同名不同值的 const ⇒ 侧车非法 ESM
  // （`const x = positive.shift(1); const x = positive.shift(5);`）⇒ 退回展开式。
  if (absList.length > 1) {
    const projs = nodes.map((n) => (n ? projectDerivationDsl(n, paramName) : undefined));
    const roots = nodes.map((n) => {
      if (!n) return undefined;
      const chain = derivationChain(n);
      return chain[chain.length - 1];
    });
    const root0 = roots[0];
    const sameRoot =
      root0 !== undefined &&
      root0.kind === "root" &&
      roots.every((r) => r !== undefined && r.id === root0.id && r.kind === "root");
    const uniform =
      projs.every((p) => p !== undefined) &&
      projs.every(
        (p) => p!.expr === projs[0]!.expr && p!.prelude.join("\n") === projs[0]!.prelude.join("\n"),
      );
    if (sameRoot && uniform) {
      const prelude: string[] = [];
      const imports: Array<{ name: string; from: string }> = [];
      for (const p of projs) {
        for (const line of p!.prelude) if (!prelude.includes(line)) prelude.push(line);
        for (const imp of p!.imports) {
          if (!imports.some((i) => i.name === imp.name && i.from === imp.from)) {
            imports.push(imp);
          }
        }
      }
      const shiftCounts = nodes.map((n) =>
        derivationChain(n!).filter((x) => x.kind === "shift").length,
      );
      return {
        constraint,
        dsl: projs[0]!.expr,
        prelude,
        imports,
        compositional: true,
        rootNodeId: root0.id,
        shiftCount: Math.max(...shiftCounts),
      };
    }
  }
  return {
    constraint,
    dsl: formatConstraint(constraint),
    prelude: [],
    imports: [],
    compositional: false,
  };
}

/**
 * 返回位：优先相对参数 local 的 shift（`x.shift(2)`）；
 * 无参数锚则 root 直链；再无则展开式。
 *
 * 多调用点（同一 root 的多个调用点）逐个投影：**各调用点的相对/直链投影一致**
 * 才用组合式（文本与接受集合都稳定 ⇒ 不随调用点个数漂移，Bug 988）。
 */
export function projectReturnSlot(
  retAbs: Abs[],
  params: DerivedParam[],
  paramNames: string[],
):
  | {
      constraint: NudoConstraint;
      dsl: string;
      prelude: string[];
      imports: Array<{ name: string; from: string }>;
      compositional: boolean;
    }
  | undefined {
  if (retAbs.length === 0) return undefined;
  // 推导标签**先于 join**读取（joinAbs/makeSum 可能返回入参本身 ⇒ join 标签
  // 按对象身份顶替掉入参的 shift 链，Bug 988）。
  const nodes = retAbs.map((a) => getDerivation(a));
  const constraint = joinThenProject(retAbs);
  if (constraint === undefined) return undefined;

  if (retAbs.length === 1) {
    const node = nodes[0]!;
    if (node && !derivationChain(node).some((n) => n.kind === "join" || n.kind === "opaque")) {
      const rel = projectReturnRelativeToParams(node, params, paramNames, constraint);
      if (rel) {
        return {
          constraint,
          dsl: rel.dsl,
          prelude: rel.prelude,
          imports: rel.imports,
          compositional: true,
        };
      }
      const proj = projectDerivationDsl(node, paramNames[0] ?? "ret");
      if (proj) {
        return {
          constraint,
          dsl: proj.expr,
          prelude: proj.prelude,
          imports: proj.imports,
          compositional: true,
        };
      }
    }
  }
  if (retAbs.length > 1) {
    // 逐调用点相对锚定（用**该调用点自己的**返回约束做消歧）
    const rels = retAbs.map((a, i) => {
      const node = nodes[i]!;
      if (!node) return undefined;
      if (derivationChain(node).some((n) => n.kind === "join" || n.kind === "opaque")) {
        return undefined;
      }
      const c = joinThenProject([a]);
      if (c === undefined) return undefined;
      return projectReturnRelativeToParams(node, params, paramNames, c);
    });
    if (rels.every((r) => r !== undefined)) {
      const exprs = new Set(rels.map((r) => r!.dsl));
      if (exprs.size === 1) {
        return {
          constraint,
          dsl: rels[0]!.dsl,
          prelude: rels[0]!.prelude,
          imports: rels[0]!.imports,
          compositional: true,
        };
      }
    }
    // 相对锚定不成立 → root 直链投影（各调用点一致才用）
    const projs = retAbs.map((a, i) => {
      const node = nodes[i]!;
      return node ? projectDerivationDsl(node, "ret") : undefined;
    });
    if (
      projs.every((p) => p !== undefined) &&
      projs.every(
        (p) => p!.expr === projs[0]!.expr && p!.prelude.join("\n") === projs[0]!.prelude.join("\n"),
      )
    ) {
      return {
        constraint,
        dsl: projs[0]!.expr,
        prelude: projs[0]!.prelude,
        imports: projs[0]!.imports,
        compositional: true,
      };
    }
  }
  return {
    constraint,
    dsl: formatConstraint(constraint),
    prelude: [],
    imports: [],
    compositional: false,
  };
}

/**
 * 返回相对某个已投影参数：按推导图 root 节点 id 结构匹配（禁止扫 DSL 字符串；
 * 同约束双参各打独立 root 标签，id 唯一）。例：param = positive.shift(1)（local
 * x），return = x.shift(2) → `x.shift(2)`。
 *
 * **同 root 的多个形参只按 root id 无法区分**（Bug 984：`helper(x+5, x+1)`
 * 的两个形参共用同一个 root id ⇒ 循环取到第一个候选 ⇒ 把**另一个形参**的
 * 约束写成返回约束 ⇒ 契约 unsound）。⇒ 多候选时按**约束值**消歧（返回位的
 * 约束必须与被选形参一致）；仍不唯一 ⇒ **拒绝**相对锚定（调用方退回直链
 * 投影），宁可少一层关系，也不写错契约。
 */
export function projectReturnRelativeToParams(
  node: DerivationNode,
  params: DerivedParam[],
  paramNames: string[],
  retConstraint?: NudoConstraint,
): { dsl: string; prelude: string[]; imports: Array<{ name: string; from: string }> } | undefined {
  const chain = derivationChain(node); // [leaf … root]
  const root = chain[chain.length - 1];
  if (!root || root.kind !== "root") return undefined;

  const shifts: number[] = [];
  for (let j = chain.length - 2; j >= 0; j--) {
    const n = chain[j]!;
    if (n.kind !== "shift" || n.offset === undefined) return undefined;
    shifts.push(n.offset);
  }

  // 候选：同一 root 节点上的形参（无结构锚的形参位不参与）
  const candidates: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p.rootNodeId === undefined || p.rootNodeId !== root.id) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return undefined;

  let chosen: number;
  if (candidates.length === 1) {
    chosen = candidates[0]!;
  } else {
    // 多候选：按约束值消歧（返回位约束 == 形参约束 ⇒ 同一形参）
    if (retConstraint === undefined) return undefined;
    const key = formatConstraint(retConstraint);
    const hits = candidates.filter((i) => formatConstraint(params[i]!.constraint) === key);
    if (hits.length !== 1) return undefined;
    chosen = hits[0]!;
  }

  const p = params[chosen]!;
  const paramShiftCount = p.shiftCount ?? 0;
  if (shifts.length < paramShiftCount) return undefined;
  const tail = shifts.slice(paramShiftCount);
  if (tail.length === 0) {
    return { dsl: p.dsl, prelude: [], imports: [] };
  }
  // 相对表达式的基 = **形参自身的 dsl**（无 shift 的形参 dsl 是 root 约束表达式
  // ——`p.name` 在侧车里并未绑定，用它会产出悬空标识符）
  let expr = p.dsl || p.name || paramNames[chosen] || "x";
  for (const off of tail) expr = `${expr}.shift(${off})`;
  return { dsl: expr, prelude: [], imports: [] };
}

