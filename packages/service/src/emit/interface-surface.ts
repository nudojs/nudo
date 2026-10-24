/**
 * `nudo contract` 的打印数据源（design-refine-derivation §11 第 0 步）：
 * 逐顶层函数展示有效契约分层——effectiveInterface 命中（手写契约 / 侧车
 * 生成段）时 params/returns 用 formatConstraint 组合式显示；未命中走
 * implicit：优先 CaseResult.argAbs / FunctionAnalysis.combinedAbs（无损
 * Abs 源），展示用 formatShape（外延口径，不强求约束式、不带 conf）。
 *
 * autoBind 沿 package.json#nudo.contract（findProjectConfig → interfaceConfig）
 * 下传，可用 opts 覆盖（测试 / CLI 显式开关）；读盘用 defaultLoadModule
 * （与 check 的 refine 解析同一扩展名表）。
 *
 * B3 Phase B：`nudo.cache` / NUDO_CACHE_DIR 打开时，整文件 effectiveInterface
 * 表（含 implicit 负缓存 null）落盘；二次冷启动跳过侧车 exec / 契约合并。
 * 缓存只服务打印/表面，不加速 evaluator 分析（design-persistent-cache §0）。
 *
 * 不变量（Invariants）：
 * - **形参表只有一个来源 = 声明形参表**（analyzer 的 formals）。effective 档
 *   的槽位与顺序取 formals（展示名与 `nudo check` 签名面同源）；契约里绑不
 *   上的参数另列一栏并显式标注（not a formal parameter），**不顶替形参名**
 *   ——否则同一函数在 `nudo contract` / `nudo check` 两面给出两套形参。
 * - **磁盘缓存是约束的无损投影**：约束不是纯 JSON 数据（`lazy` 槽是函数、
 *   字面量可能是 bigint / ±Infinity / NaN / -0），故落盘走自带编解码
 *   （字面量带类型标签；`lazy` 槽存节点表下标，读回**重建 thunk**）。
 *   ⇒ 冷跑与缓存命中跑**逐字相同**；编码/解码异常一律 fail-open
 *   （不入表 / 重算），绝不因序列化缺陷让整条命令崩溃。
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  contractParamNameSet,
  derefConstraint,
  effectiveInterface,
  formatConstraint,
  formatShape,
  formalParamSignatureNames,
  interfaceDiagCount,
  isIntFlag,
  localNamedExports,
  refineDiagCount,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  takeRefineDiagsSince,
  TYPEOF_NAMES,
  type Abs,
  type EffectiveInterface,
  type FormalParam,
  type LiteralValue,
  type NudoConstraint,
  type NudoField,
  type NudoFnConstraint,
  type Pred,
  type PrimName,
  type Term,
  type TypeofName,
} from "@nudojs/core";
import { analyzeFileAsync } from "../analyzer.ts";
import { type CallRecord } from "../evaluator/call-record.ts";
import { defaultLoadModule, type LoadModule } from "../load-module.ts";
import { findProjectConfig, interfaceConfig, diskCacheRoot } from "../evaluator/config.ts";
import { DiskCache, ifaceCacheKey } from "../disk-cache.ts";
import { collectLoadDepContents } from "../dep-contents.ts";

/** loadModule 闭包依赖内容：iface 缓存键维度（含 ambient 侧车 / ESM import）。
 *  truncated → 禁用磁盘复用（未入键 dep 变更不会 miss）。 */
function collectDepContents(
  filePath: string,
  source: string,
  loadModule?: LoadModule,
): { depContents: Array<{ path: string; content: string | null }>; truncated: boolean } {
  return collectLoadDepContents(filePath, source, loadModule ?? defaultLoadModule);
}

export type InterfaceSurfaceEntry = {
  fn: string;
  /** 本文件 named export（自动绑定边界口径：localNamedExports） */
  kind: "export" | "local";
  source: "handwritten" | "generated" | "implicit";
  params: Array<{ name: string; display: string }>;
  returns?: string;
  /**
   * 契约里**不在声明形参表**中的参数（Bug 559）：单列一栏并显式标注，
   * 不再顶替形参名（形参表只有一个来源 = 声明形参表，与 `nudo check`
   * 的签名面同口径）。
   */
  extraParams?: Array<{ name: string; display: string }>;
};

export type InterfaceSurfaceOpts = {
  /** 覆盖项目配置的 autoBind（默认 findProjectConfig → interfaceConfig） */
  autoBind?: boolean;
  /** 模块源码装载器（测试注入）；默认 defaultLoadModule 真实读盘 */
  loadModule?: LoadModule;
  /** 跨文件调用记录（--from 采集）：implicit 展示的实参域原料 */
  records?: CallRecord[];
  /** 打开 buffer 覆盖磁盘源码（E5：agent/LSP 与 hover 同口径） */
  source?: string;
};

/** 契约参数不属于声明形参表时的显式标注（不顶替形参名） */
const NOT_FORMAL_MARK = "(not a formal parameter)";

/** 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） */
export function formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string {
  const params = `(${e.params.map((p) => `${p.name}: ${p.display}`).join(", ")})`;
  let line = `  ${e.fn}  [${e.source}]  ${params}`;
  if (e.returns !== undefined) line += ` → ${e.returns}`;
  if (e.extraParams && e.extraParams.length > 0) {
    const extra = e.extraParams
      .map((p) => `${p.name}: ${p.display} ${NOT_FORMAL_MARK}`)
      .join(", ");
    line += `  | contract: ${extra}`;
  }
  if (e.kind === "local") line += "  (local)";
  return line;
}

/** Abs → implicit 展示串（外延口径，不带 conf） */
function absToImplicitDisplay(a: Abs): string {
  try {
    return formatShape(a);
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// 契约面打印：以**声明形参表**为骨架（Bug 559）
//
// 旧实现直接渲染**契约里的参数**（effectiveInterface.params）⇒ 契约参数名
// 冒充函数形参名（`fn({ zzz: … })` 印成 `(zzz: …)`），而 `nudo check` 的签名面
// 印的是函数真实形参（`(x: any)`）⇒ 同一函数两套形参（跨 verb 自相矛盾）。
//
// ⇒ 骨架取**声明形参表**（analyzer 的 formals；展示名与 `nudo check` 签名面
// 同源：formalParamSignatureNames）；契约里绑不上的参数单列一栏并显式标注
// 「not a formal parameter」——不再顶替形参名。
// ---------------------------------------------------------------------------

/** 形参槽位：展示名 + 该槽位可绑定的契约参数名 */
type FormalSlot = {
  /** 槽位展示名（解构形参渲染 `{ a, b }`，与 check 签名面同口径） */
  name: string;
  /** 该槽位可绑定的契约参数名（id/default=名字；rest=名字+显示名；解构=绑定名/嵌套路径） */
  bindable: string[];
};

/** 单个形参可绑定的契约参数名（与 core 的 contractParamNameSet 同口径） */
function formalBindableNames(f: FormalParam): string[] {
  switch (f.kind) {
    case "id":
    case "default":
      return [f.name];
    case "rest":
      return [f.name, f.display];
    case "pattern":
      return [f.placeholder, "_", ...f.bound, ...f.nestedPaths];
  }
}

/** 声明形参表 → 槽位（无 formals 信息时退回 paramNames） */
function formalSlotsOf(fn: {
  paramNames: string[];
  formals?: FormalParam[];
}): FormalSlot[] {
  if (fn.formals && fn.formals.length > 0) {
    const names = formalParamSignatureNames(fn.formals);
    return fn.formals.map((f, i) => ({
      name: names[i] ?? `_p${f.index}`,
      bindable: formalBindableNames(f),
    }));
  }
  return fn.paramNames.map((name) => ({ name, bindable: [name] }));
}

/**
 * effective 档的打印条目：形参表为骨架 + 契约参数另列。
 * 契约参数名对不上形参表时**不顶替**形参名（显式标注、另列一栏）。
 */
function effectiveEntry(
  fn: { name: string; paramNames: string[]; formals?: FormalParam[] },
  eff: EffectiveInterface,
  kind: "export" | "local",
): InterfaceSurfaceEntry {
  const slots = formalSlotsOf(fn);
  const bindable = contractParamNameSet(fn.formals ?? []);
  const conflictNames = new Set(eff.conflict?.params ?? []);
  const displays: string[][] = slots.map(() => []);
  const extraParams: Array<{ name: string; display: string }> = [];
  for (const p of eff.params) {
    const idx = slots.findIndex((s) => s.bindable.includes(p.param));
    if (idx >= 0) {
      displays[idx]!.push(formatConstraint(p.constraint));
    } else if (bindable.has(p.param) || conflictNames.has(p.param)) {
      // 绑得上但无槽位 / 冲突参数（check 面另报 conflict）⇒ 不另列
      continue;
    } else {
      extraParams.push({ name: p.param, display: formatConstraint(p.constraint) });
    }
  }
  return {
    fn: fn.name,
    kind,
    source: eff.source,
    params: slots.map((s, i) => ({
      name: s.name,
      // 形参未被契约约束 ⇒ 无契约义务（与 check 签名面「未约束 = any」同口径）
      display: displays[i]!.length > 0 ? [...new Set(displays[i]!)].join(" | ") : "any",
    })),
    returns: eff.returns ? formatConstraint(eff.returns.constraint) : undefined,
    ...(extraParams.length > 0 ? { extraParams } : {}),
  };
}

// ---------------------------------------------------------------------------
// 约束 ↔ 缓存 JSON 的**无损**编解码（Bug 529 / 534）
//
// 约束不是纯 JSON 数据，两处 JSON 直转都会丢信息：
// - `lazy` 槽是**函数**（thunk）——`JSON.stringify` 遇函数值属性**静默省略**
//   ⇒ 递归约束退化成「无字段的 optional 槽」（读回 any().optional()）：
//   冷跑与热跑输出不同，且热跑比门禁面更宽松（跨产物面自相矛盾）。
// - `preds` 里的字面量含 bigint——`JSON.stringify` 直接抛
//   ⇒ 整条 `nudo contract` 崩溃（裸 Do not know how to serialize a BigInt）。
//
// ⇒ 自带结构化编码：字面量带类型标签（bigint / ±Infinity / NaN / -0 /
// undefined 皆可还原）；`lazy` 槽按 **thunk 身份** 记进节点表，读回时
// **重建 thunk**（闭包指向重建后的节点）⇒ 递归语义与冷跑逐字一致。
// ---------------------------------------------------------------------------

/** 字面量编码：JSON 无 bigint / ±Infinity / NaN / -0 / undefined ⇒ 带类型标签 */
type EncodedLiteral =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "numNegZero" }
  | { t: "numNaN" }
  | { t: "numInf"; v: 1 | -1 }
  | { t: "bool"; v: boolean }
  | { t: "bigint"; v: string }
  | { t: "null" }
  | { t: "undefined" };

type EncodedTerm =
  | { op: "lit"; value: EncodedLiteral }
  | { op: "var"; id: string }
  | { op: "app"; fn: string; args: EncodedTerm[] };

type EncodedPred =
  | { op: "true" }
  | { op: "false" }
  | { op: "eq" | "ne" | "lt" | "le" | "gt" | "ge"; a: EncodedTerm; b: EncodedTerm }
  | { op: "and" | "or"; args: EncodedPred[] }
  | { op: "not"; arg: EncodedPred }
  | { op: "typeof"; t: EncodedTerm; type: string }
  | { op: "assumeFinite"; t: EncodedTerm };

/** 约束节点编码：lazy 槽 = 节点表下标（自引用靠下标回指成环） */
type EncodedConstraint = {
  __nudoConstraint: true;
  prim?: string;
  preds?: EncodedPred[];
  fields?: Record<string, { constraint: EncodedConstraint; optional?: boolean }>;
  element?: EncodedConstraint;
  int?: boolean;
  isOptional?: boolean;
  members?: EncodedConstraint[];
  fn?: {
    params: Record<string, EncodedConstraint>;
    returns?: EncodedConstraint;
    throws?: EncodedConstraint;
  };
  /** lazy 槽 → 节点表下标（thunk 身份去重后的展开节点） */
  lazy?: number;
};

/** 编码期共享状态：thunk 身份 → 节点表下标（同一 thunk 恒同一展开） */
type ConstraintCodec = {
  nodes: EncodedConstraint[];
  thunkIndex: Map<object, number>;
};

function encodeLiteral(v: LiteralValue): EncodedLiteral {
  if (v === null) return { t: "null" };
  if (v === undefined) return { t: "undefined" };
  switch (typeof v) {
    case "string":
      return { t: "str", v };
    case "boolean":
      return { t: "bool", v };
    case "bigint":
      return { t: "bigint", v: v.toString() };
    case "number":
      if (Number.isNaN(v)) return { t: "numNaN" };
      if (v === Infinity) return { t: "numInf", v: 1 };
      if (v === -Infinity) return { t: "numInf", v: -1 };
      if (Object.is(v, -0)) return { t: "numNegZero" };
      return { t: "num", v };
    default:
      throw new Error(`nudo: unsupported literal value type (${typeof v})`);
  }
}

function decodeLiteral(l: EncodedLiteral): LiteralValue {
  switch (l.t) {
    case "str":
      return l.v;
    case "num":
      return l.v;
    case "numNegZero":
      return -0;
    case "numNaN":
      return Number.NaN;
    case "numInf":
      return l.v === 1 ? Infinity : -Infinity;
    case "bool":
      return l.v;
    case "bigint":
      return BigInt(l.v);
    case "null":
      return null;
    case "undefined":
      return undefined;
  }
}

function encodeTerm(t: Term): EncodedTerm {
  switch (t.op) {
    case "lit":
      return { op: "lit", value: encodeLiteral(t.value) };
    case "var":
      return { op: "var", id: t.id };
    case "app":
      return { op: "app", fn: t.fn, args: t.args.map(encodeTerm) };
  }
}

function decodeTerm(t: EncodedTerm): Term {
  switch (t.op) {
    case "lit":
      return { op: "lit", value: decodeLiteral(t.value) };
    case "var":
      return { op: "var", id: t.id };
    case "app":
      return { op: "app", fn: t.fn, args: t.args.map(decodeTerm) };
  }
}

function encodePred(p: Pred): EncodedPred {
  switch (p.op) {
    case "true":
    case "false":
      return { op: p.op };
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return { op: p.op, a: encodeTerm(p.a), b: encodeTerm(p.b) };
    case "and":
    case "or":
      return { op: p.op, args: p.args.map(encodePred) };
    case "not":
      return { op: "not", arg: encodePred(p.arg) };
    case "typeof":
      return { op: "typeof", t: encodeTerm(p.t), type: p.type };
    case "assumeFinite":
      return { op: "assumeFinite", t: encodeTerm(p.t) };
  }
}

function decodePred(p: EncodedPred): Pred {
  switch (p.op) {
    case "true":
    case "false":
      return { op: p.op };
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return { op: p.op, a: decodeTerm(p.a), b: decodeTerm(p.b) };
    case "and":
    case "or":
      return { op: p.op, args: p.args.map(decodePred) };
    case "not":
      return { op: "not", arg: decodePred(p.arg) };
    case "typeof": {
      const name = p.type as TypeofName;
      if (!TYPEOF_NAMES.includes(name)) {
        throw new Error(`nudo: corrupted interface cache (unknown typeof name '${p.type}')`);
      }
      return { op: "typeof", t: decodeTerm(p.t), type: name };
    }
    case "assumeFinite":
      return { op: "assumeFinite", t: decodeTerm(p.t) };
  }
}

/** lazy 槽 → 节点表下标：按 thunk 身份去重（自引用 ⇒ 同一下标，天然成环） */
function encodeLazySlot(c: NudoConstraint, codec: ConstraintCodec): number {
  const thunk = c.lazy as object;
  const seen = codec.thunkIndex.get(thunk);
  if (seen !== undefined) return seen;
  const idx = codec.nodes.length;
  codec.nodes.push({ __nudoConstraint: true }); // 占位：先占下标再展开（自引用安全）
  codec.thunkIndex.set(thunk, idx);
  codec.nodes[idx] = encodeConstraint(derefConstraint(c), codec);
  return idx;
}

function encodeConstraint(c: NudoConstraint, codec: ConstraintCodec): EncodedConstraint {
  const out: EncodedConstraint = { __nudoConstraint: true };
  if (c.prim !== undefined) out.prim = c.prim;
  if (c.preds.length > 0) out.preds = c.preds.map(encodePred);
  if (c.fields) {
    const fields: Record<string, { constraint: EncodedConstraint; optional?: boolean }> = {};
    for (const [k, f] of Object.entries(c.fields)) {
      fields[k] = {
        constraint: encodeConstraint(f.constraint, codec),
        ...(f.optional ? { optional: true } : {}),
      };
    }
    out.fields = fields;
  }
  if (c.element !== undefined) out.element = encodeConstraint(c.element, codec);
  if (isIntFlag(c)) out.int = true;
  if (c.isOptional) out.isOptional = true;
  if (c.members) out.members = c.members.map((m) => encodeConstraint(m, codec));
  if (c.fn) {
    const params: Record<string, EncodedConstraint> = {};
    for (const [k, v] of Object.entries(c.fn.params)) params[k] = encodeConstraint(v, codec);
    out.fn = {
      params,
      ...(c.fn.returns !== undefined ? { returns: encodeConstraint(c.fn.returns, codec) } : {}),
      ...(c.fn.throws !== undefined ? { throws: encodeConstraint(c.fn.throws, codec) } : {}),
    };
  }
  if (c.lazy) out.lazy = encodeLazySlot(c, codec);
  return out;
}

/** 可写目标（编解码就地填充；NudoConstraint 的 readonly 在此局部放开） */
type MutableConstraint = { -readonly [K in keyof NudoConstraint]: NudoConstraint[K] };

/**
 * 就地填充一个约束节点：`lazy` 槽按节点表下标**重建 thunk**
 * （闭包指向重建后的节点对象）⇒ 读回后 derefConstraint 的展开结果
 * 与冷跑同构（递归层数由消费端的 depth 预算控制）。
 */
function fillConstraint(
  dst: MutableConstraint,
  src: EncodedConstraint,
  built: NudoConstraint[],
  nodeBase: number,
): void {
  if (src.prim !== undefined) dst.prim = src.prim as PrimName;
  dst.preds = (src.preds ?? []).map(decodePred);
  if (src.fields) {
    const fields: Record<string, NudoField> = {};
    for (const [k, f] of Object.entries(src.fields)) {
      const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
      fillConstraint(nested, f.constraint, built, nodeBase);
      fields[k] = { constraint: nested, ...(f.optional ? { optional: true } : {}) };
    }
    dst.fields = fields;
  }
  if (src.element !== undefined) {
    const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
    fillConstraint(nested, src.element, built, nodeBase);
    dst.element = nested;
  }
  if (src.int) dst.int = true;
  if (src.isOptional) dst.isOptional = true;
  if (src.members) {
    dst.members = src.members.map((m) => {
      const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
      fillConstraint(nested, m, built, nodeBase);
      return nested;
    });
  }
  if (src.fn) {
    const params: Record<string, NudoConstraint> = {};
    for (const [k, v] of Object.entries(src.fn.params)) {
      const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
      fillConstraint(nested, v, built, nodeBase);
      params[k] = nested;
    }
    const fnSlot: NudoFnConstraint = { params };
    if (src.fn.returns !== undefined) {
      const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
      fillConstraint(nested, src.fn.returns, built, nodeBase);
      fnSlot.returns = nested;
    }
    if (src.fn.throws !== undefined) {
      const nested: MutableConstraint = { __nudoConstraint: true, preds: [] };
      fillConstraint(nested, src.fn.throws, built, nodeBase);
      fnSlot.throws = nested;
    }
    dst.fn = fnSlot;
  }
  if (src.lazy !== undefined) {
    const target = built[src.lazy + nodeBase];
    if (!target) {
      throw new Error(`nudo: corrupted interface cache (lazy node ${src.lazy} out of range)`);
    }
    dst.lazy = () => target;
  }
}

/**
 * 编码结果 → 约束：root 为槽 0，节点表第 j 项落在槽 j+1
 * （lazy 槽的下标按同一偏移换算）。
 */
function decodeConstraint(root: EncodedConstraint, nodes: EncodedConstraint[]): NudoConstraint {
  const built: NudoConstraint[] = [];
  for (let i = 0; i <= nodes.length; i++) {
    built.push({ __nudoConstraint: true, preds: [] });
  }
  for (let j = 0; j < nodes.length; j++) {
    fillConstraint(built[j + 1] as MutableConstraint, nodes[j]!, built, 1);
  }
  fillConstraint(built[0] as MutableConstraint, root, built, 1);
  return built[0]!;
}

type CachedEffectiveInterface = {
  fnName: string;
  params: Array<{ param: string; constraint: EncodedConstraint }>;
  returns?: { constraint: EncodedConstraint };
  source: "handwritten" | "generated" | "implicit";
  conflict?: { params: string[]; returns?: boolean };
  /**
   * 合取**不可判定**（能力边界，非语义不可满足）——Bug 1141：结构型合取
   * 不得静默丢掉另一侧的字段义务；合不了的形态组合按 Bug 340 口径不判
   * conflict，但必须显式留痕（core 的 check 面据此发 warning 诊断）。
   * 形状与 conflict 同款，便于缓存面无损透传。
   */
  undecidable?: { params: string[]; returns?: boolean };
};

/**
 * 缓存表格式版本：编码规则变更 ⇒ 旧表整层 miss（不得当命中读）
 *
 * v3（族 48 · 2026-10-23）：bigint 字面量契约的 `litC(bigint)` 补上了
 * `prim: "bigint"` ⇒ 约束编码（类型义务 + 字面量项）变了 ⇒ 旧表必须整层 miss。
 */
const IFACE_TABLE_VERSION = 3;

/** null = implicit 负缓存 */
type IfaceTableJson = {
  v?: number;
  fns: Record<string, CachedEffectiveInterface | null>;
  /** lazy thunk 展开表：下标 → 约束节点（lazy 槽按下标回指） */
  nodes?: EncodedConstraint[];
};

/** 约束 → 缓存 JSON（无损：lazy 槽 / bigint 等字面量皆可还原） */
function constraintToJson(
  c: NudoConstraint,
  codec: ConstraintCodec,
): EncodedConstraint {
  return encodeConstraint(c, codec);
}

/** 缓存 JSON → 约束（重建 lazy thunk；表损坏 ⇒ throw，由调用方 fail-open 重算） */
function cachedToEffective(
  e: CachedEffectiveInterface,
  nodes: EncodedConstraint[],
): EffectiveInterface {
  return {
    fnName: e.fnName,
    params: e.params.map((p) => ({
      param: p.param,
      constraint: decodeConstraint(p.constraint, nodes),
    })),
    ...(e.returns
      ? { returns: { constraint: decodeConstraint(e.returns.constraint, nodes) } }
      : {}),
    source: e.source,
    ...(e.conflict ? { conflict: e.conflict } : {}),
    ...(e.undecidable ? { undecidable: e.undecidable } : {}),
  };
}

/**
 * 单文件 interface 表面：analyzer 推断结果给出函数清单与 implicit 展示，
 * effectiveInterface 给出契约命中（手写 > 生成段）。诊断 side-channel
 * 在收尾时取走丢弃——打印命令不执法，interface-load 等错误留给 check 路径。
 */
export async function interfaceSurface(
  filePath: string,
  opts: InterfaceSurfaceOpts = {},
): Promise<InterfaceSurfaceEntry[]> {
  const abs = resolve(filePath);
  const source = opts.source ?? readFileSync(abs, "utf-8");
  const fromBuffer = opts.source !== undefined;
  // since 锚：收尾只排干本次打印自身产生的诊断——全量 take 会在 LSP 长驻
  // 进程的 await 窗口窃取在途 validateText 待消费诊断（接口/精化两通道同防）
  const ifaceSince = interfaceDiagCount();
  const refineSince = refineDiagCount();
  const proj = findProjectConfig(dirname(abs));
  const autoBind = opts.autoBind ?? interfaceConfig(proj?.config).autoBind;
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const exported = localNamedExports(source);
  const kindOf = (fnName: string): "export" | "local" => (exported.has(fnName) ? "export" : "local");

  const analysis = await analyzeFileAsync(abs, source, undefined, opts.records, loadModule);

  // B3：整文件 effectiveInterface 表磁盘缓存（打印路径；不加速 analyze）
  // buffer 源 / 注入 loadModule / callsites 时禁用磁盘缓存（键不含 buffer）
  let disk: DiskCache | undefined;
  let ifaceKey: string | undefined;
  let cachedTable: IfaceTableJson | undefined;
  if (!opts.loadModule && !opts.records && !fromBuffer) {
    const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
    disk = new DiskCache({ root: cacheRoot, namespace: "iface" });
    if (disk.enabled) {
      let sidecarSource: string | undefined;
      try {
        const sc = sidecarPathOf(abs);
        if (autoBind !== false) {
          // buffer-aware 侧车优先
          const openSc = loadModule(`./${sc.slice(sc.lastIndexOf("/") + 1)}`, abs);
          if (openSc !== undefined) sidecarSource = openSc;
          else if (existsSync(sc)) sidecarSource = readFileSync(sc, "utf-8");
        }
      } catch {
        sidecarSource = undefined;
      }
      const dep = collectDepContents(abs, source, loadModule);
      // 闭包截断 / bare-spec miss → 键不全，禁用磁盘复用
      const hasBareMiss = (dep.depContents ?? []).some((d) => d.content == null);
      if (dep.truncated || hasBareMiss) {
        ifaceKey = undefined;
        cachedTable = undefined;
      } else {
        ifaceKey = ifaceCacheKey(abs, source, {
          autoBind: autoBind !== false,
          projectDir: proj?.projectDir,
          sidecarSource,
          depContents: dep.depContents,
          projectEnvNames: proj?.config.env ?? [],
        });
        cachedTable = disk.get<IfaceTableJson>(ifaceKey);
        // 编码规则版本不符 → 整层 miss（旧表按新规则读会失真，不得当命中）
        if (cachedTable && cachedTable.v !== IFACE_TABLE_VERSION) cachedTable = undefined;
      }
    }
  }

  const entries: InterfaceSurfaceEntry[] = [];
  const freshTable: IfaceTableJson = { v: IFACE_TABLE_VERSION, fns: {} };
  const codec: ConstraintCodec = { nodes: [], thunkIndex: new Map() };
  const useCache = cachedTable !== undefined;

  const effectiveOf = (fnName: string): EffectiveInterface | undefined =>
    effectiveInterface(source, fnName, {
      loadModule,
      fromFile: abs,
      autoBind,
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
    });

  for (const fn of analysis.functions) {
    let eff: EffectiveInterface | undefined;
    if (useCache) {
      const hit = cachedTable!.fns[fn.name];
      if (hit === null) {
        eff = undefined; // implicit 负缓存
      } else if (hit) {
        try {
          eff = cachedToEffective(hit, cachedTable!.nodes ?? []);
        } catch {
          // 缓存损坏 ⇒ fail-open 重算（与冷跑一致，不退化成 implicit 档）
          eff = effectiveOf(fn.name);
        }
      }
    } else {
      eff = effectiveOf(fn.name);
      // 编码失败（不该发生：编码器对 bigint / lazy 皆无损）⇒ 该函数不入表，
      // 绝不因序列化缺陷让整条命令崩溃（Bug 534）。
      if (eff) {
        try {
          freshTable.fns[fn.name] = {
            fnName: eff.fnName,
            params: eff.params.map((p) => ({
              param: p.param,
              constraint: constraintToJson(p.constraint, codec),
            })),
            ...(eff.returns
              ? { returns: { constraint: constraintToJson(eff.returns.constraint, codec) } }
              : {}),
            // 磁盘表保留真实分档；implicit 也可序列化（展示层用）
            source: eff.source,
            ...(eff.conflict ? { conflict: eff.conflict } : {}),
            ...(eff.undecidable ? { undecidable: eff.undecidable } : {}),
          };
        } catch {
          delete freshTable.fns[fn.name];
        }
      } else {
        freshTable.fns[fn.name] = null;
      }
    }
    if (eff) {
      entries.push(effectiveEntry(fn, eff, kindOf(fn.name)));
      continue;
    }
    // implicit：argAbs / combinedAbs（无损 Abs 源）；展示仍外延串。
    const params = fn.paramNames.map((name, i) => {
      const seen: string[] = [];
      for (const c of fn.cases) {
        const absArg = c.argAbs[i];
        if (absArg) {
          const s = absToImplicitDisplay(absArg);
          if (!seen.includes(s)) seen.push(s);
        }
      }
      return { name, display: seen.length > 0 ? seen.join(" | ") : "unknown" };
    });
    let ret: string | undefined;
    if (fn.combinedAbs) {
      ret = absToImplicitDisplay(fn.combinedAbs);
    } else if (fn.cases.length > 0) {
      const last = fn.cases[fn.cases.length - 1]!;
      ret = absToImplicitDisplay(last.abs);
    }
    entries.push({ fn: fn.name, kind: kindOf(fn.name), source: "implicit", params, returns: ret });
  }

  if (disk?.enabled && ifaceKey && !useCache && analysis.functions.length > 0) {
    try {
      // lazy 展开节点表随表落盘（读回时据此重建 thunk）
      if (codec.nodes.length > 0) freshTable.nodes = codec.nodes;
      disk.set(ifaceKey, freshTable);
    } catch {
      /* fail-open */
    }
  }

  takeInterfaceDiagsSince(ifaceSince); // 清空本次增量，防跨命令/在途验证互窃
  takeRefineDiagsSince(refineSince);
  return entries;
}
