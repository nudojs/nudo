/**
 * Derivation slot projection（Abs → 组合式 DSL 投影缝）。
 * 自 interface-derivation.ts 机械拆出；语义未改。
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
  const constraint = joinThenProject(absList);
  if (constraint === undefined) return undefined;

  if (absList.length === 1) {
    const node = getDerivation(absList[0]!);
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
  // 多调用点 join：各链均可组合式且同一 root → 保持组合式（union(shift…)）
  if (absList.length > 1) {
    const nodes = absList.map((a) => getDerivation(a));
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
    if (sameRoot && projs.every((p) => p !== undefined)) {
      const exprs = [...new Set(projs.map((p) => p!.expr))];
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
      const dsl = exprs.length === 1 ? exprs[0]! : `union(${exprs.join(", ")})`;
      const shiftCounts = nodes.map((n) =>
        derivationChain(n!).filter((x) => x.kind === "shift").length,
      );
      return {
        constraint,
        dsl,
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
  const constraint = joinThenProject(retAbs);
  if (constraint === undefined) return undefined;

  if (retAbs.length === 1) {
    const node = getDerivation(retAbs[0]!);
    if (node && !derivationChain(node).some((n) => n.kind === "join" || n.kind === "opaque")) {
      const rel = projectReturnRelativeToParams(node, params, paramNames);
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
 */
export function projectReturnRelativeToParams(
  node: DerivationNode,
  params: DerivedParam[],
  paramNames: string[],
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

  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    // 无结构锚（join/展开式参数位）无法建立关系；有锚必须同一 root 节点
    if (p.rootNodeId === undefined || p.rootNodeId !== root.id) continue;

    const paramShiftCount = p.shiftCount ?? 0;
    if (shifts.length < paramShiftCount) continue;
    const tail = shifts.slice(paramShiftCount);
    if (tail.length === 0) {
      return { dsl: p.dsl, prelude: [], imports: [] };
    }
    let expr = p.name || paramNames[i] || "x";
    for (const off of tail) expr = `${expr}.shift(${off})`;
    return { dsl: expr, prelude: [], imports: [] };
  }
  return undefined;
}

