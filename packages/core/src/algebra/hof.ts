/**
 * HOF 关系 Abs：无 body 的外延关系（paramTypes → returnType）的判定、
 * α 替换与应用。类型变量仍是 term var；关系仍是 fn 形状上的外延槽。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, confJoin, unknown } from "./abs.ts";
import type { Term } from "./term.ts";
import { simplifyTerm, v as termVar, termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import { and, pTrue, pFalse, substPred } from "./pred.ts";
import { getFnImpl } from "./abs-fn.ts";
import { joinAbs } from "./objects.ts";
import type { AstEnv } from "./ast-eval.ts";

// --- P2 types ---

/** 关系来源标记：P4 豁免与 diagnostics 依赖它，禁止隐式猜 */
export type RelSource = "promote" | "refine" | "relationFn";

export type HofSite = {
  /** 形参名（函数形参） */
  param: string;
  /** 输入侧 term：实参的 term（element 的 var/lit/app）；map 1 个、reduce 2 个 */
  argTerms: Term[];
  /** 输出侧：归纳出的返回 Abs */
  result: Abs;
  /** 源位置，便于 diagnostics */
  loc?: { line: number; column: number };
};

/**
 * run 局部 collector（与 Phi 并列，不进 Φ 合并）。
 * 仅 generalize 的 symbolic 一次跑安装；instantiate 重跑不装。
 */
export type HofCollectCtx = {
  /** 本次归纳的形参名集合（身份判定用） */
  paramNames: ReadonlySet<string>;
  /** 本次 typeParams 的 α id 集合（term 复用白名单） */
  alphaIds: Set<string>;
  /** fresh α 计数 */
  freshSeq: { n: number };
  sites: HofSite[];
  fnRels: Map<string, { abs: Abs; source: RelSource }>;
  entryShapes: Map<string, { abs: Abs; source: RelSource }>;
};

export function createHofCollectCtx(
  paramNames: ReadonlySet<string>,
  alphaIds: Iterable<string>,
): HofCollectCtx {
  return {
    paramNames,
    alphaIds: new Set(alphaIds),
    freshSeq: { n: 0 },
    sites: [],
    fnRels: new Map(),
    entryShapes: new Map(),
  };
}

/**
 * 仅当 term 是 var 且 id ∈ alphaIds（本次 typeParams）时复用；否则 fresh α。
 * 绝不把调用点具体值/字面量冻进关系。
 */
export function alphaOf(
  absOrTerm: Abs | Term | undefined,
  ctx: HofCollectCtx,
): Term {
  const t =
    absOrTerm && typeof absOrTerm === "object" && "shape" in absOrTerm
      ? (absOrTerm as Abs).term
      : (absOrTerm as Term | undefined);
  if (t?.op === "var" && ctx.alphaIds.has(t.id)) return t;
  ctx.freshSeq.n += 1;
  const id = `T${ctx.freshSeq.n}`;
  ctx.alphaIds.add(id);
  return termVar(id);
}

/** 共享输出变量 B:${param}（§5.1 P2 钉死） */
export function betaOf(param: string): Term {
  return termVar(`B:${param}`);
}

/**
 * 提升写入载体：替换 env.vars map 项，禁止 mutate 共享 Abs。
 * arrival-first：已有 fn/arr 形状 → 拒绝新观测。
 * 返回是否真正写入。
 */
export function promoteParamShape(
  env: AstEnv,
  param: string,
  promotedShape: Shape,
  opts?: { loc?: { line: number; column: number }; recordSite?: boolean },
): boolean {
  const prev = env.vars.get(param);
  if (!prev) return false;
  // 已有具体形状（含 refine 契约）→ 契约/先到优先，不提升
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return false;

  const next: Abs = {
    shape: promotedShape,
    term: prev.term,
    pred: prev.pred,
    conf: "path",
  };
  // 替换 map 项，不 mutate prev
  env.vars.set(param, next);

  const hc = env.hofCollect;
  if (hc && hc.paramNames.has(param)) {
    if (promotedShape.k === "fn") {
      if (!hc.fnRels.has(param) && !hc.entryShapes.has(param)) {
        hc.fnRels.set(param, { abs: { ...next }, source: "promote" });
      }
    } else {
      if (!hc.fnRels.has(param) && !hc.entryShapes.has(param)) {
        hc.entryShapes.set(param, { abs: { ...next }, source: "promote" });
      }
    }
    // HofSite 只记「函数形参的应用点」；arr 提升不是应用点，禁止污染 sites
    if (opts?.recordSite !== false && promotedShape.k === "fn") {
      const result =
        promotedShape.returnType ?? next;
      hc.sites.push({
        param,
        argTerms: [],
        result,
        loc: opts?.loc,
      });
    }
  }
  return true;
}

const HOF_ARR_METHODS = new Set(["map", "filter", "reduce", "flatMap"]);

/**
 * 挂载点①：方法派发 miss。receiver 是形参 Identifier 且 shape 为 any/未知，
 * 方法名为 filter/map/reduce/flatMap → 提升为 arr(自身 var)。
 */
export function tryPromoteReceiverAsArr(
  env: AstEnv,
  receiverName: string,
  method: string,
  loc?: { line: number; column: number },
): Abs | undefined {
  if (!HOF_ARR_METHODS.has(method)) return undefined;
  const hc = env.hofCollect;
  if (!hc || !hc.paramNames.has(receiverName)) return undefined;
  const prev = env.vars.get(receiverName);
  if (!prev) return undefined;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return undefined;
  const element = prev.term
    ? abs(prev.shape, prev.term, prev.pred, "path")
    : abs({ k: "any" }, undefined, undefined, "path");
  const arrShape: Shape = { k: "arr", element };
  promoteParamShape(env, receiverName, arrShape, { loc });
  return env.vars.get(receiverName);
}

/**
 * 挂载点②：CallExpression callee = 形参 Identifier 直接调用 p(x) / p(a,b)。
 * 提升为 fn(paramTypes=[αOf(args)], returnType=B:param)。
 */
export function tryPromoteDirectCall(
  env: AstEnv,
  calleeName: string,
  args: Abs[],
  loc?: { line: number; column: number },
): Abs | undefined {
  const hc = env.hofCollect;
  if (!hc || !hc.paramNames.has(calleeName)) return undefined;
  const prev = env.vars.get(calleeName);
  if (!prev) return undefined;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") {
    // 已有形状：只记 hofSites，不改形状；result 用 returnType，不是整个 fn Abs
    if (prev.shape.k === "fn") {
      hc.sites.push({
        param: calleeName,
        argTerms: args.map((a) => a.term ?? { op: "var", id: "_" }),
        result: prev.shape.returnType ?? prev,
        loc,
      });
    }
    return undefined;
  }
  const paramTypes = args.map((a) =>
    abs({ k: "any" }, alphaOf(a, hc), undefined, "path"),
  );
  const ret = abs({ k: "any" }, betaOf(calleeName), undefined, "path");
  const fnShape: Shape = {
    k: "fn",
    params: args.map((_, i) => `x${i}`),
    paramTypes,
    returnType: ret,
  };
  promoteParamShape(env, calleeName, fnShape, { loc, recordSite: false });
  hc.sites.push({
    param: calleeName,
    argTerms: args.map((a) => a.term ?? { op: "var", id: "_" }),
    result: ret,
    loc,
  });
  return env.vars.get(calleeName);
}

/**
 * 挂载点③：HOF 回调实参。回调是 Identifier ∈ paramNames 且尚未有 fn 形状。
 * 按方法名提升：map/flatMap → fn([αOf(el)], B:param)；filter → fn([αOf(el)], bool)；
 * reduce → fn([αOf(init), αOf(el)], B:param)。
 */
export function tryPromoteHofCallback(
  env: AstEnv,
  cbName: string,
  method: string,
  argAbses: Abs[],
  loc?: { line: number; column: number },
): Abs | undefined {
  const hc = env.hofCollect;
  if (!hc || !hc.paramNames.has(cbName)) return undefined;
  const prev = env.vars.get(cbName);
  if (!prev) return undefined;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return undefined;

  let paramTypes: Abs[];
  let returnType: Abs;
  if (method === "filter") {
    paramTypes = argAbses.map((a) =>
      abs({ k: "any" }, alphaOf(a, hc), undefined, "path"),
    );
    returnType = abs({ k: "prim", type: "boolean" }, undefined, undefined, "path");
  } else if (method === "reduce") {
    paramTypes = argAbses.map((a) =>
      abs({ k: "any" }, alphaOf(a, hc), undefined, "path"),
    );
    returnType = abs({ k: "any" }, betaOf(cbName), undefined, "path");
  } else {
    // map / flatMap / 默认
    paramTypes = argAbses.map((a) =>
      abs({ k: "any" }, alphaOf(a, hc), undefined, "path"),
    );
    returnType = abs({ k: "any" }, betaOf(cbName), undefined, "path");
  }
  const fnShape: Shape = {
    k: "fn",
    params: argAbses.map((_, i) => `x${i}`),
    paramTypes,
    returnType,
  };
  promoteParamShape(env, cbName, fnShape, { loc, recordSite: false });
  hc.sites.push({
    param: cbName,
    argTerms: argAbses.map((a) => a.term ?? { op: "var", id: "_" }),
    result: returnType,
    loc,
  });
  return env.vars.get(cbName);
}

/** deep-ish copy for snapshot（新对象，不是 env.vars 同一引用） */
export function snapshotAbs(a: Abs): Abs {
  const shape = a.shape;
  const copyShape = (s: Shape): Shape => {
    switch (s.k) {
      case "arr":
        return { ...s, element: snapshotAbs(s.element) };
      case "tuple": {
        const next: Shape = {
          k: "tuple",
          elements: s.elements.map(snapshotAbs),
        };
        if (s.rest) next.rest = snapshotAbs(s.rest);
        return next;
      }
      case "fn": {
        const next: Shape = { k: "fn", params: [...s.params] };
        if (s.name !== undefined) next.name = s.name;
        if (s.paramTypes) next.paramTypes = s.paramTypes.map(snapshotAbs);
        if (s.returnType) next.returnType = snapshotAbs(s.returnType);
        return next;
      }
      case "sum":
        return { ...s, members: s.members.map(snapshotAbs) };
      case "obj": {
        const slots: Record<
          string,
          { value: Abs; optional?: boolean; readonly?: boolean }
        > = {};
        for (const [k, slot] of Object.entries(s.slots)) {
          const nextSlot: { value: Abs; optional?: boolean; readonly?: boolean } =
            { value: snapshotAbs(slot.value) };
          if (slot.optional) nextSlot.optional = true;
          if (slot.readonly) nextSlot.readonly = true;
          slots[k] = nextSlot;
        }
        const next: Shape = { k: "obj", slots };
        if (s.index) {
          next.index = {
            key: snapshotAbs(s.index.key),
            value: snapshotAbs(s.index.value),
          };
        }
        if (s.open) next.open = true;
        return next;
      }
      case "brand":
        return { ...s, shape: snapshotAbs(s.shape) };
      case "eff":
        return { ...s, inner: snapshotAbs(s.inner) };
      default:
        return s;
    }
  };
  return {
    shape: copyShape(shape),
    term: a.term,
    pred: a.pred,
    conf: a.conf,
  };
}


/**
 * 「有可用外延签名」判定：唯一权威定义。
 *
 * 名实说明：isRelFn **不要求** term 是 var。完全单态的具体签名
 * （paramTypes=[number], returnType=string）同样满足——map 有槽就用。
 * 多态（term=var）只是其中一种形态；名字里的 Rel 指「关系槽可用」。
 *
 * 收紧条件——仅有 returnType 而 paramTypes 与 arity 不对齐时，不算 rel，
 * 防止半截签名在 map 里冒充关系。
 */
export function isRelFn(a: Abs | undefined | null): boolean {
  if (!a || typeof a !== "object") return false;
  if (getFnImpl(a)) return false;
  const s = a.shape;
  if (!s || s.k !== "fn") return false;
  if (s.returnType === undefined) return false;
  if (s.paramTypes === undefined) return s.params.length === 0;
  return s.paramTypes.length === s.params.length;
}

// --- pred 归约 ---

function litOfTerm(t: Term): number | string | boolean | null | undefined {
  return t.op === "lit" ? t.value : undefined;
}

function foldCompare(
  op: Pred["op"],
  a: number | string | boolean | null | undefined,
  b: number | string | boolean | null | undefined,
): Pred | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (typeof a !== typeof b) {
    if (op === "eq") return pFalse;
    if (op === "ne") return pTrue;
    return undefined;
  }
  switch (op) {
    case "eq":
      return a === b ? pTrue : pFalse;
    case "ne":
      return a !== b ? pTrue : pFalse;
    case "lt":
      return (a as number) < (b as number) ? pTrue : pFalse;
    case "le":
      return (a as number) <= (b as number) ? pTrue : pFalse;
    case "gt":
      return (a as number) > (b as number) ? pTrue : pFalse;
    case "ge":
      return (a as number) >= (b as number) ? pTrue : pFalse;
    default:
      return undefined;
  }
}

function predUsesMappedVars(p: Pred, map: ReadonlyMap<string, Abs>): boolean {
  const walkTerm = (t: Term): boolean => {
    if (t.op === "var") return map.has(t.id);
    if (t.op === "app") return t.args.some(walkTerm);
    return false;
  };
  const walk = (q: Pred): boolean => {
    switch (q.op) {
      case "true":
      case "false":
        return false;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return walkTerm(q.a) || walkTerm(q.b);
      case "and":
      case "or":
        return q.args.some(walk);
      case "not":
        return walk(q.arg);
      case "typeof":
        return walkTerm(q.t);
    }
  };
  return walk(p);
}

/** map 内有无 term 的实参（shape-only）→ 无法维持蕴含，整 pred 降 true */
function mapHasShapeOnlyVar(p: Pred, map: ReadonlyMap<string, Abs>): boolean {
  const walkTerm = (t: Term): boolean => {
    if (t.op === "var") {
      const arg = map.get(t.id);
      return !!arg && arg.term === undefined;
    }
    if (t.op === "app") return t.args.some(walkTerm);
    return false;
  };
  const walk = (q: Pred): boolean => {
    switch (q.op) {
      case "true":
      case "false":
        return false;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return walkTerm(q.a) || walkTerm(q.b);
      case "and":
      case "or":
        return q.args.some(walk);
      case "not":
        return walk(q.arg);
      case "typeof":
        return walkTerm(q.t);
    }
  };
  return walk(p);
}

/**
 * pred 三条规则：
 * 1. var ∈ map + 实参有 term → 换 term，可归约则归约，否则残余保留
 * 2. var ∈ map + 实参无 term → pred → true（conf 由调用方降级）
 * 3. var ∉ map（自由 α）→ 原样保留
 */
export function substPredAbs(
  p: Pred,
  map: ReadonlyMap<string, Abs>,
): { pred: Pred; dropped: boolean } {
  if (!predUsesMappedVars(p, map)) return { pred: p, dropped: false };
  if (mapHasShapeOnlyVar(p, map)) return { pred: pTrue, dropped: true };

  const substTerm = (t: Term): Term => {
    if (t.op === "var") {
      const arg = map.get(t.id);
      return arg?.term ?? t;
    }
    if (t.op === "app") {
      return { op: "app", fn: t.fn, args: t.args.map(substTerm) };
    }
    return t;
  };

  const replaced = substPred(p, substTerm);

  const fold = (q: Pred): Pred => {
    switch (q.op) {
      case "true":
      case "false":
        return q;
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge": {
        const a = litOfTerm(q.a);
        const b = litOfTerm(q.b);
        const folded = foldCompare(q.op, a, b);
        return folded ?? q;
      }
      case "and": {
        const args = q.args.map(fold);
        if (args.some((x) => x.op === "false")) return pFalse;
        const rest = args.filter((x) => x.op !== "true");
        if (rest.length === 0) return pTrue;
        if (rest.length === 1) return rest[0]!;
        return and(...rest);
      }
      case "or": {
        const args = q.args.map(fold);
        if (args.some((x) => x.op === "true")) return pTrue;
        const rest = args.filter((x) => x.op !== "false");
        if (rest.length === 0) return pFalse;
        if (rest.length === 1) return rest[0]!;
        return { op: "or", args: rest };
      }
      case "not": {
        const inner = fold(q.arg);
        if (inner.op === "true") return pFalse;
        if (inner.op === "false") return pTrue;
        return { op: "not", arg: inner };
      }
      case "typeof":
        return q;
    }
  };

  return { pred: fold(replaced), dropped: false };
}

// --- substAbs ---

function substTermAbs(t: Term, map: ReadonlyMap<string, Abs>): Term {
  if (t.op === "var") {
    const arg = map.get(t.id);
    return arg?.term ?? t;
  }
  if (t.op === "app") {
    return simplifyTerm({
      op: "app",
      fn: t.fn,
      args: t.args.map((x) => substTermAbs(x, map)),
    });
  }
  return t;
}

function substShape(
  s: Shape,
  map: ReadonlyMap<string, Abs>,
  seen: Set<object>,
): Shape {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
    case "prim":
      return s;
    case "brand":
      return { ...s, shape: substAbsInner(s.shape, map, seen) };
    case "eff":
      return { ...s, inner: substAbsInner(s.inner, map, seen) };
    case "arr":
      return { ...s, element: substAbsInner(s.element, map, seen) };
    case "tuple": {
      const elements = s.elements.map((e) => substAbsInner(e, map, seen));
      const next: Shape = { k: "tuple", elements };
      if (s.rest) next.rest = substAbsInner(s.rest, map, seen);
      return next;
    }
    case "fn": {
      const next: Shape = { k: "fn", params: s.params };
      if (s.name !== undefined) next.name = s.name;
      if (s.paramTypes) {
        next.paramTypes = s.paramTypes.map((p) => substAbsInner(p, map, seen));
      }
      if (s.returnType !== undefined) {
        next.returnType = substAbsInner(s.returnType, map, seen);
      }
      return next;
    }
    case "sum":
      return { ...s, members: s.members.map((m) => substAbsInner(m, map, seen)) };
    case "obj": {
      const slots: Record<
        string,
        { value: Abs; optional?: boolean; readonly?: boolean }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        const nextSlot: { value: Abs; optional?: boolean; readonly?: boolean } =
          { value: substAbsInner(slot.value, map, seen) };
        if (slot.optional) nextSlot.optional = true;
        if (slot.readonly) nextSlot.readonly = true;
        slots[k] = nextSlot;
      }
      const next: Shape = { k: "obj", slots };
      if (s.index) {
        next.index = {
          key: substAbsInner(s.index.key, map, seen),
          value: substAbsInner(s.index.value, map, seen),
        };
      }
      if (s.open) next.open = true;
      return next;
    }
  }
}

function substAbsInner(
  a: Abs,
  map: ReadonlyMap<string, Abs>,
  seen: Set<object>,
): Abs {
  if (seen.has(a)) return a;
  // term 是映射内 var：整 Abs 替换
  if (a.term?.op === "var" && map.has(a.term.id)) {
    const repl = map.get(a.term.id)!;
    return {
      shape: repl.shape,
      term: repl.term,
      pred: repl.pred,
      conf: confJoin(a.conf, repl.conf),
    };
  }

  seen.add(a);
  const shape = substShape(a.shape, map, seen);
  const term = a.term ? substTermAbs(a.term, map) : undefined;

  let pred = a.pred;
  let conf = a.conf;
  if (a.pred) {
    const r = substPredAbs(a.pred, map);
    pred = r.pred;
    if (r.dropped) conf = confJoin(conf, "partial");
  }

  return abs(shape, term, pred, conf);
}

/**
 * α 替换：map 的 key 是 term var id，value 是替换 Abs。
 * var ∉ map 原样保留（含自由 α 上的 term/pred）。
 */
export function substAbs(a: Abs, map: ReadonlyMap<string, Abs>): Abs {
  if (map.size === 0) return a;
  return substAbsInner(a, map, new Set());
}

/**
 * relation-only / isRelFn 的应用：按 paramTypes 做 α 替换得到 returnType。
 * impl.relation 槽优先于 shape.returnType。重复 α 先绑定保留。
 */
export function instantiateReturn(fn: Abs, args: Abs[]): Abs {
  const shape = fn.shape;
  if (!shape || shape.k !== "fn") return unknown;
  const src = getFnImpl(fn)?.relation ?? {
    paramTypes: shape.paramTypes ?? [],
    returnType: shape.returnType ?? unknown,
  };
  const map = new Map<string, Abs>();
  src.paramTypes.forEach((p, i) => {
    if (p.term?.op !== "var") return;
    const id = p.term.id;
    if (map.has(id)) return;
    map.set(id, args[i] ?? unknown);
  });
  return substAbs(src.returnType, map);
}

/**
 * 回调统一入口（单点定义）。A–F + sum：
 * A Node inline | B apply | C body | D relation | E isRelFn | F unknown
 *
 * 实现委托 ast-eval 的 applyAbsFn（已含 sum / D / E / body 优先）。
 * Identifier 解析层：env.vars 有 Abs → B–E；env.fns 有 → callFunction；否则 unknown。
 *
 * 为避免 hof ↔ ast-eval 循环依赖，本函数由宿主在运行时绑定。
 *
 * 依赖说明：宿主在 `ast-eval.ts` 模块加载时注册（副作用）。
 * 只 import hof.ts 而未加载 ast-eval 时，fallback 仅认 relation/isRelFn。
 * 与 §5.1 的「禁止全局 collector」不同——这里是无状态委托钩子，不是 run 局部状态。
 */
type ApplyCallbackHost = (
  cb: Abs | { type: string },
  args: Abs[],
  env: unknown,
  phi: unknown,
  budget: unknown,
) => Abs;

let applyCallbackHost: ApplyCallbackHost | undefined;

/** ast-eval 模块加载时注册；勿在多份 ast-eval 实例下各写各的 */
export function setApplyCallbackHost(fn: ApplyCallbackHost): void {
  applyCallbackHost = fn;
}

export function applyCallbackAbs(
  cb: Abs | { type: string },
  args: Abs[],
  env: unknown,
  phi: unknown,
  budget: unknown,
): Abs {
  if (!applyCallbackHost) {
    // fallback：纯 Abs 关系路径（测试/无宿主）
    if (cb && typeof cb === "object" && "shape" in cb) {
      const a = cb as Abs;
      const impl = getFnImpl(a);
      if (impl?.relation) return instantiateReturn(a, args);
      if (isRelFn(a)) return instantiateReturn(a, args);
    }
    return unknown;
  }
  return applyCallbackHost(cb, args, env, phi, budget);
}

// --- 双路径共享结果投影（ast-eval 与 exec/class 禁止各写一套）---

/** undefined 值的统一 Abs 表示（forEach/find 等） */
export function undefAbs(): Abs {
  return abs(
    { k: "unknown" },
    { op: "lit", value: undefined as never },
    pTrue,
    "exact",
  );
}

/**
 * map 元素投影：body 在符号实参上跑出 unknown 时，
 * 用 shape.returnType 槽，conf 由调用方按 path/partial 处理。
 * rel 回调不会走到这里（instantiateReturn 已给出结果）。
 */
export function mapElementFallback(
  cbAbs: Abs | undefined,
  elem: Abs,
  out: Abs,
): Abs {
  if (out.shape.k !== "unknown" || elem.term?.op !== "var") return out;
  const slot = cbAbs?.shape.k === "fn" ? cbAbs.shape.returnType : undefined;
  return slot ?? out;
}

/**
 * flatMap 统一结果：展开后的元素 join 成 arr(γ)。
 * JS flatMap 永远返回 Array；双路径共用此投影，禁止一边 tuple 一边 arr。
 * 同 term 元素 first-wins（joinAbs 会丢 β 身份，见 design §5.1）。
 */
export function projectFlatMapResult(
  arrConf: Confidence,
  mapped: Abs[],
): Abs {
  const flatEls: Abs[] = [];
  let anyUnknown = false;
  for (const m of mapped) {
    if (m.shape.k === "arr") flatEls.push(m.shape.element);
    else if (m.shape.k === "tuple") flatEls.push(...m.shape.elements);
    else anyUnknown = true;
  }
  if (anyUnknown || flatEls.length === 0) return unknown;
  const first = flatEls[0]!;
  const sameIdentity = flatEls.every((e) => {
    if (e.shape.k !== first.shape.k) return false;
    if (!e.term && !first.term) return true;
    if (!e.term || !first.term) return false;
    return termToString(e.term) === termToString(first.term);
  });
  const el = sameIdentity ? first : flatEls.reduce((a, b) => joinAbs(a, b));
  return abs(
    { k: "arr", element: el },
    undefined,
    undefined,
    confJoin(arrConf, "path"),
  );
}

/** 从 map/filter/reduce 回调实参里取出 Abs（Identifier 已绑定或直接 Abs） */
export function asAbs(v: unknown): Abs | undefined {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  return undefined;
}
