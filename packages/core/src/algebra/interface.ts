/**
 * Interface 分层推导（design-refine-derivation §2.1/§2.2/§11 第 0 步）：
 *
 *   effectiveInterface(source, fnName) —— 手写 ∪ 侧车同名绑定 ∪ 生成段的
 *   唯一读取口，来源标注（handwritten / generated / implicit）随值返回。
 *
 * 来源三层（合并序 handwritten > generated > implicit，§4/§11）：
 * - handwritten：源码 `@nudo:refine`/`@nudo:interface` 行（复用 refine.ts 的
 *   extractRefinesFromSource / extractRefineReturnFromSource）∪ 侧车同名**手写**
 *   fn() 绑定。同名同参取合取 and()（§2.1：侧车 x>0 + 源码 x>1 → 有效契约
 *   取合取）；常数界交叉矛盾（x>0 ∧ x<0）→ conflict 标记，由调用方报
 *   nudo:interface-conflict——本函数不 throw。
 * - generated：侧车同名导出且声明上方注释块含 @generated 标记（emit 产物）。
 *   与手写并存时整体降级忽略（手写为准；混排由 nudo:interface-name-clash /
 *   drift 在 emit/check 侧处理）。
 * - implicit：无任何契约 → 返回 undefined（隐式推断是调用方的事）。
 *
 * 自动绑定边界（§2.2）：只绑源文件**本地 named export**（re-export /
 * export default / 私有名不绑）；opts.autoBind === false 或侧车路径含
 * /node_modules/ → 不 ambient 加载（只看源码 refine）。「项目根内」检查属
 * 宿主层（core 无 projectDir 概念），Phase 1 不在此实现。
 *
 * 侧车绑定 Phase 1 只承诺 fn() 形态：非 fn 的标量/shape 绑定不消费，收集
 * nudo:interface-load 诊断（后续 Phase 再放开单参形态）。
 *
 * 诊断走本文件独立 side-channel（先例 refine.ts 的 setRefineDiagCollector）：
 * 侧车加载/执行失败 → nudo:interface-cycle / nudo:interface-load。
 */

import type { Pred } from "./pred.ts";
import { predToString } from "./pred.ts";
import type { Term } from "./term.ts";
import { termToString } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import { hashSource } from "./hash-source.ts";
import { resolveDepPath, sidecarPathOf } from "./sidecar-path.ts";
import {
  type NudoConstraint,
  isNudoConstraint,
  fnConstraintToEntryReqs,
  and,
  isIntFlag,
} from "./constraint.ts";
import {
  execNudoModule,
  NudoSidecarError,
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  takeRefineDiags,
  type RefineResolveOpts,
} from "./refine.ts";

// 单一定义在 sidecar-path.ts（leaf）；re-export 维持 @nudojs/core 导出面稳定
export { sidecarPathOf };

// ---------------------------------------------------------------------------
// 诊断 side-channel（镜像 refine.ts 的 RefineDiag 机制）
// ---------------------------------------------------------------------------

/** interface 推导诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） */
export type InterfaceDiag = { code: string; message: string; file?: string };

let interfaceDiagCollector: ((d: InterfaceDiag) => void) | null = null;
let interfaceDiagSeq = 0;
const interfaceDiags: Array<{ seq: number; d: InterfaceDiag }> = [];
/** 防长会话无界增长；消费方 takeInterfaceDiags 按批取走 */
const MAX_INTERFACE_DIAGS = 1024;

/** 设置诊断观察者（null 清除）；缓冲照常累积，takeInterfaceDiags 取走 */
export function setInterfaceDiagCollector(
  fn: ((d: InterfaceDiag) => void) | null,
): void {
  interfaceDiagCollector = fn;
}

/** 当前诊断累计序号（since 锚：工具面只排干自身探测产生的增量） */
export function interfaceDiagCount(): number {
  return interfaceDiagSeq;
}

/** 取走已收集的诊断（收集即清空） */
export function takeInterfaceDiags(): InterfaceDiag[] {
  const out = interfaceDiags.map((e) => e.d);
  interfaceDiags.length = 0;
  return out;
}

/**
 * 只取走 seq > since 的诊断（清空仅限增量）——LSP 长驻进程里 lens/打印/
 * emit 工具用它排干**自身探测**产生的诊断，不窃取在途 validateText 待消费
 * 的接口诊断（全量 take 曾在 await 窗口偷走 checkSource 的待收诊断）。
 */
export function takeInterfaceDiagsSince(since: number): InterfaceDiag[] {
  const out: InterfaceDiag[] = [];
  let kept = 0;
  for (const e of interfaceDiags) {
    if (e.seq > since) out.push(e.d);
    else interfaceDiags[kept++] = e;
  }
  interfaceDiags.length = kept;
  return out;
}

function collectDiag(d: InterfaceDiag): void {
  if (interfaceDiags.length >= MAX_INTERFACE_DIAGS) interfaceDiags.shift();
  interfaceDiags.push({ seq: ++interfaceDiagSeq, d });
  interfaceDiagCollector?.(d);
}

// ---------------------------------------------------------------------------
// 侧车路径 / 本地导出表 / 生成段识别
// ---------------------------------------------------------------------------

/** 有效契约来源：手写（源码 refine ∪ 侧车手写绑定）> 生成段 > 隐式 */
export type InterfaceSource = "handwritten" | "generated" | "implicit";

// sidecarPathOf 定义已收敛至 sidecar-path.ts（leaf），文件头 re-export

/**
 * 源文件本地 named export 表：只收**顶层** `export function/const/class/let`
 * 声明的名字。排除 re-export（`export {x} from` / `export *`）、`export default`
 * 与本地列表形式 `export { x }`——同名自动绑定只认「本文件声明并导出」。
 */
export function localNamedExports(source: string): Set<string> {
  const out = new Set<string>();
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(source, { errorRecovery: true });
  } catch {
    return out; // 解析失败：无本地导出信息，不阻断（refine 行走 regex 路径）
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    if (stmt.source) continue; // export {…} from "…"（re-export）
    const d = stmt.declaration;
    if (!d) continue; // export { x } 本地列表（非声明形式）
    if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      if (d.id) out.add(d.id.name);
    } else if (d.type === "VariableDeclaration") {
      if (d.kind !== "const" && d.kind !== "let") continue; // export var 不在约定内
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier") out.add(decl.id.name);
      }
    }
  }
  return out;
}

/**
 * 侧车源码的生成段导出名：导出名所在声明的**前置注释块**含 `@generated`
 * 标记（emit 产物 canonical 注释为 `@generated by nudo`）→ 该名为 generated。
 * Phase 1 简化：只看紧邻声明上方的注释块（与 extractRefineLines 同款反向
 * 行扫描，空行可跨）；隔了代码行 / 无标记 / re-export 列表均不算。
 */
export function generatedExportNames(sidecarSrc: string): Set<string> {
  const out = new Set<string>();
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(sidecarSrc, { errorRecovery: true });
  } catch {
    return out;
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    if (stmt.source) continue;
    const d = stmt.declaration;
    if (!d || stmt.start == null) continue;
    const names: string[] = [];
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier") names.push(decl.id.name);
      }
    } else if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      if (d.id) names.push(d.id.name);
    }
    if (names.length === 0) continue;
    // 用语句 start（"export" 关键字处，通常行首）向上扫注释块
    if (leadingCommentHas(stmt.start, sidecarSrc)) {
      for (const n of names) out.add(n);
    }
  }
  return out;
}

/** 从 pos 向上扫连续注释块（空行可跨），块内含 @generated → true */
function leadingCommentHas(pos: number, src: string, marker: RegExp): boolean;
function leadingCommentHas(pos: number, src: string): boolean;
function leadingCommentHas(pos: number, src: string, marker = /@generated/): boolean {
  const lines = src.slice(0, pos).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      if (marker.test(line)) return true;
      continue;
    }
    break;
  }
  return false;
}

// ---------------------------------------------------------------------------
// effectiveInterface
// ---------------------------------------------------------------------------

export type EffectiveInterfaceOpts = RefineResolveOpts & {
  /** false（或谓词返回 false）→ 不 ambient 加载侧车；默认 true */
  autoBind?: boolean | ((sidecarPath: string) => boolean);
};

export type EffectiveInterface = {
  fnName: string;
  params: Array<{ param: string; constraint: NudoConstraint }>;
  returns?: { constraint: NudoConstraint };
  source: InterfaceSource;
  /**
   * 合取不可满足标记：params = 常数界交叉矛盾（或 prim 矛盾等 and() 不可
   * 合取形态）的参数名；returns = 返回位同样不可满足。调用方报
   * nudo:interface-conflict 并跳过对应位执法。
   */
  conflict?: { params: string[]; returns?: boolean };
};

/** 自动绑定边界：/node_modules/ 永不 ambient 加载；autoBind 可关（§2.2） */
function sidecarAutoBindAllowed(
  sidecarPath: string,
  autoBind: boolean | ((sidecarPath: string) => boolean) | undefined,
): boolean {
  if (sidecarPath.includes("/node_modules/")) return false;
  if (autoBind === undefined || autoBind === true) return true;
  if (typeof autoBind === "function") return autoBind(sidecarPath) === true;
  return false;
}

/** 侧车同名绑定（已过 autoBind/本地导出门）；无侧车来源 → undefined */
type SidecarBinding =
  | {
      ok: true;
      sidecarPath: string;
      /** fn() 形态约束（Phase 1 唯一消费形态；非 fn 形态已收集诊断） */
      constraint: NudoConstraint & { fn: NonNullable<NudoConstraint["fn"]> };
      generated: boolean;
    }
  | { ok: false };

function loadSidecarBinding(
  source: string,
  fnName: string,
  opts: EffectiveInterfaceOpts,
): SidecarBinding {
  const { loadModule, fromFile, autoBind } = opts;
  if (!loadModule || !fromFile) return { ok: false };
  const sidecarPath = sidecarPathOf(fromFile);
  if (!sidecarAutoBindAllowed(sidecarPath, autoBind)) return { ok: false };
  if (!localNamedExports(source).has(fnName)) return { ok: false };
  const spec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  const sidecarSrc = loadModule(spec, fromFile);
  if (sidecarSrc === undefined) return { ok: false };
  let exports: Record<string, unknown>;
  try {
    exports = execNudoModule(sidecarSrc, { loadModule, fromFile: sidecarPath });
  } catch (e) {
    collectDiag({
      code: e instanceof NudoSidecarError ? e.code : "nudo:interface-load",
      message: `sidecar '${spec}' for '${fnName}' failed: ${e instanceof Error ? e.message : String(e)}`,
      file: sidecarPath,
    });
    return { ok: false };
  }
  const binding = exports[fnName];
  if (binding === undefined) return { ok: false };
  if (!isNudoConstraint(binding)) {
    collectDiag({
      code: "nudo:interface-load",
      message: `sidecar '${spec}' export '${fnName}' is not a Nudo constraint`,
      file: sidecarPath,
    });
    return { ok: false };
  }
  if (!binding.fn) {
    // Phase 1 侧车绑定只承诺 fn() 形态；标量/shape 单参形态后续 Phase 放开
    collectDiag({
      code: "nudo:interface-load",
      message: `sidecar '${spec}' binding '${fnName}' is not fn() form (Phase 1 consumes only fn({ … }, …) bindings)`,
      file: sidecarPath,
    });
    return { ok: false };
  }
  return {
    ok: true,
    sidecarPath,
    constraint: binding as NudoConstraint & { fn: NonNullable<NudoConstraint["fn"]> },
    generated: generatedExportNames(sidecarSrc).has(fnName),
  };
}

/** 数值/长度常数界（self 模板项上的 gt/ge/lt/le，and 嵌套展开） */
type Bound = { lower: boolean; strict: boolean; n: number; term: string };

function boundsOf(c: NudoConstraint): Bound[] {
  const out: Bound[] = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return;
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return;
    if (p.a.op !== "var" && p.a.op !== "app") return;
    out.push({
      lower: p.op === "gt" || p.op === "ge",
      strict: p.op === "gt" || p.op === "lt",
      n: p.b.value,
      term: termToString(p.a),
    });
  };
  c.preds.forEach(visit);
  return out;
}

/**
 * 最小 unsat：同参两约束的同项常数界交叉矛盾（§2.1：x>0 ∧ x<0）。
 * 双非严格界仅在开区间为空时矛盾（x≥0 ∧ x≤0 在 x=0 可满足）。
 */
function crossBoundConflict(a: NudoConstraint, b: NudoConstraint): boolean {
  const A = boundsOf(a);
  const B = boundsOf(b);
  for (const x of A) {
    for (const y of B) {
      if (x.term !== y.term || x.lower === y.lower) continue;
      const lo = x.lower ? x : y;
      const hi = x.lower ? y : x;
      if (lo.strict || hi.strict ? lo.n >= hi.n : lo.n > hi.n) return true;
    }
  }
  return false;
}

/**
 * 同参合一：and() 合取；不可合取（prim 不一致 / 非 shape 标量等 and()
 * throw）= 合取不可满足——onConflict 标记后保既有（消费方跳过执法）。
 */
function conjoinOrConflict(
  prev: NudoConstraint,
  next: NudoConstraint,
  onConflict: () => void,
): NudoConstraint {
  try {
    return and(prev, next);
  } catch {
    onConflict();
    return prev;
  }
}

/**
 * 单点读取口：手写 ∪ 侧车同名 ∪ 生成段 → 有效契约（含来源标注）。
 * 无任何契约 → undefined（implicit 由调用方处理）。
 */
export function effectiveInterface(
  source: string,
  fnName: string,
  opts: EffectiveInterfaceOpts = {},
): EffectiveInterface | undefined {
  // 手写来源 ①：源码 refine / interface 行（@nudo:import 模板由 refine.ts 解析）。
  // extract 触发的 @nudo:import 失败等诊断默认落 refine 通道——转发进本文件
  // side-channel，保证 takeInterfaceDiags 单口取走（否则残留 refine 通道，
  // LSP 长会话里被后续无关文件的 checkSource 吸收 = 跨文件污染）。
  const sourceEntries = extractRefinesFromSource(source, fnName, opts);
  const sourceReturn = extractRefineReturnFromSource(source, fnName, opts);
  for (const d of takeRefineDiags()) {
    collectDiag({ code: d.code, message: d.message, ...(d.file ? { file: d.file } : {}) });
  }

  // 手写来源 ② ∪ 生成段：侧车同名自动绑定
  const sidecar = loadSidecarBinding(source, fnName, opts);
  const sidecarFn = sidecar.ok ? sidecar.constraint : undefined;
  const sidecarGenerated = sidecar.ok && sidecar.generated;
  const sidecarParams = sidecarFn ? fnConstraintToEntryReqs(sidecarFn) : [];
  const sidecarReturns = sidecarFn?.fn.returns;

  const hasHandwritten =
    sourceEntries.length > 0 ||
    sourceReturn !== undefined ||
    (sidecarFn !== undefined && !sidecarGenerated);

  if (!hasHandwritten) {
    // 生成段：侧车同名 @generated 导出（无手写契约时的展示来源）
    if (sidecarFn !== undefined && sidecarGenerated) {
      return {
        fnName,
        params: sidecarParams,
        ...(sidecarReturns !== undefined ? { returns: { constraint: sidecarReturns } } : {}),
        source: "generated",
      };
    }
    return undefined; // implicit：调用方自行处理隐式
  }

  // 手写层合并：源码行先入（同名重复行合一），侧车手写绑定同参合取。
  // 不可合取（prim 矛盾 / shape×标量等 and() throw）= 合取不可满足——
  // 标记 conflict（不再静默吞侧车契约：消费方报 nudo:interface-conflict
  // 并跳过该参执法），显示保源码行。
  const params = new Map<string, NudoConstraint>();
  for (const e of sourceEntries) {
    params.set(
      e.param,
      params.has(e.param)
        ? conjoinOrConflict(params.get(e.param)!, e.constraint, () => {})
        : e.constraint,
    );
  }
  const conflictParams: string[] = [];
  if (sidecarFn !== undefined && !sidecarGenerated) {
    for (const { param, constraint } of sidecarParams) {
      const prev = params.get(param);
      if (prev !== undefined) {
        if (crossBoundConflict(prev, constraint) && !conflictParams.includes(param)) {
          conflictParams.push(param);
        }
        params.set(param, conjoinOrConflict(prev, constraint, () => {
          if (!conflictParams.includes(param)) conflictParams.push(param);
        }));
      } else {
        params.set(param, constraint);
      }
    }
  }

  // 返回约束：源码 refine return 与侧车 fn.returns 并存 → and()；
  // 交叉矛盾 / 不可合取 → conflict.returns（调用方跳过返回位执法）
  const r1 = sourceReturn?.constraint;
  const r2 = sidecarFn !== undefined && !sidecarGenerated ? sidecarReturns : undefined;
  let returnsC: NudoConstraint | undefined;
  let conflictReturns = false;
  if (r1 !== undefined && r2 !== undefined) {
    if (crossBoundConflict(r1, r2)) conflictReturns = true;
    returnsC = conjoinOrConflict(r1, r2, () => {
      conflictReturns = true;
    });
  } else {
    returnsC = r1 ?? r2;
  }

  return {
    fnName,
    params: [...params.entries()].map(([param, constraint]) => ({ param, constraint })),
    ...(returnsC !== undefined ? { returns: { constraint: returnsC } } : {}),
    source: "handwritten",
    ...(conflictParams.length > 0 || conflictReturns
      ? {
          conflict: {
            params: conflictParams,
            ...(conflictReturns ? { returns: true } : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 侧车闭包指纹（memo 键 / 逐出登记，pattern 参照 load-deps-fp.ts）
// ---------------------------------------------------------------------------

/** 防病态侧车依赖图；截断时指纹带 trunc: 前缀（调用方须 fail-open） */
const MAX_SIDECAR_FP_NODES = 64;

/** 侧车自身相对 .nudo import 的 canonical 路径表（BFS 队列填充用） */
function enqueueSidecarDeps(
  src: string,
  path: string,
  seen: Set<string>,
  queue: Array<{ spec: string; from: string }>,
): void {
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return; // 解析失败：exec 阶段报诊断，闭包无需补
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = stmt.source.value;
    if (!(spec.startsWith(".") || spec.startsWith("/"))) continue;
    if (!(spec.endsWith(".nudo.js") || spec.endsWith(".nudo.ts"))) continue;
    const depPath = resolveDepPath(path, spec);
    if (seen.has(depPath)) continue;
    seen.add(depPath);
    queue.push({ spec, from: path });
  }
}

/**
 * 侧车及递归 .nudo 依赖闭包的内容指纹：`${hashSource(侧车)}|路径=hash,…`。
 * 无 loadModule / autoBind 关闭 / node_modules / loadModule miss → undefined
 * （无侧车影响即无需指纹）。闭包截断 → `trunc:` 前缀，键不可信，调用方
 * fail-open（参照 loadModuleDepsFingerprint 的 truncated 契约）。
 */
export function sidecarClosureFingerprint(
  fromFile: string,
  opts: EffectiveInterfaceOpts,
): string | undefined {
  const { loadModule, autoBind } = opts;
  if (!loadModule) return undefined;
  const sidecarPath = sidecarPathOf(fromFile);
  if (!sidecarAutoBindAllowed(sidecarPath, autoBind)) return undefined;
  const spec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  const sidecarSrc = loadModule(spec, fromFile);
  if (sidecarSrc === undefined) return undefined;

  const parts: string[] = [];
  const seen = new Set<string>([sidecarPath]);
  const queue: Array<{ spec: string; from: string }> = [];
  enqueueSidecarDeps(sidecarSrc, sidecarPath, seen, queue);
  let truncated = false;
  while (queue.length > 0) {
    if (seen.size > MAX_SIDECAR_FP_NODES) {
      truncated = true;
      break;
    }
    const { spec: s, from } = queue.shift()!;
    const depPath = resolveDepPath(from, s);
    const depSrc = loadModule(s, from);
    parts.push(`${depPath}=${depSrc === undefined ? "miss" : hashSource(depSrc)}`);
    if (depSrc !== undefined) enqueueSidecarDeps(depSrc, depPath, seen, queue);
  }
  parts.sort();
  const fp = `${hashSource(sidecarSrc)}|${parts.join(",")}`;
  return truncated ? `trunc:${fp}` : fp;
}

// ---------------------------------------------------------------------------
// formatConstraint：组合式显示（number().gt(0) / lit(42) / union(…) / fn(…)）
// ---------------------------------------------------------------------------

function litToString(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v); // number / boolean / null
}

/** length(self) 上的 ge/le 常数界 → n（否则 undefined） */
function lengthBound(p: Pred, op: "ge" | "le"): number | undefined {
  if (p.op !== op) return undefined;
  if (p.a.op !== "app" || p.a.fn !== "length") return undefined;
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
  return p.b.value;
}

/** 单个 Pred → 链式调用段；不可链式表达 → `{谓词原文}` 兜底（仅展示用） */
function predToChain(p: Pred): string {
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      if (p.b.op !== "lit" || typeof p.b.value !== "number") break;
      if (p.a.op === "app" && p.a.fn === "length") {
        if (p.op === "ge") return `.min(${p.b.value})`;
        if (p.op === "le") return `.max(${p.b.value})`;
        break;
      }
      if (p.a.op === "var") return `.${p.op}(${p.b.value})`;
      break;
    }
    case "eq": {
      // .eq(v) 为展示伪链（构建器无 eq 链；lit 单形态在上方整体识别）
      if (p.b.op === "lit" && p.a.op === "var") return `.eq(${litToString(p.b.value)})`;
      break;
    }
    case "and": {
      // .length(n) 编码：and([ge(len,n), le(len,n)])
      if (p.args.length === 2) {
        const [a, b] = [p.args[0]!, p.args[1]!];
        for (const [x, y] of [
          [a, b],
          [b, a],
        ] as const) {
          const ge = lengthBound(x, "ge");
          const le = lengthBound(y, "le");
          if (ge !== undefined && ge === le) return `.length(${ge})`;
        }
      }
      return p.args.map(predToChain).join("");
    }
    default:
      break;
  }
  return `{${predToString(p)}}`;
}

function fmtConstraint(c: NudoConstraint): string {
  // fn({ p: … }, returns, { throws: … })
  if (c.fn) {
    const args = [
      `{ ${Object.entries(c.fn.params)
        .map(([k, v]) => `${k}: ${fmtConstraint(v)}`)
        .join(", ")} }`,
    ];
    if (c.fn.returns !== undefined) args.push(fmtConstraint(c.fn.returns));
    if (c.fn.throws !== undefined) args.push(`{ throws: ${fmtConstraint(c.fn.throws)} }`);
    return `fn(${args.join(", ")})`;
  }
  // union(m1, m2, …)
  if (c.members) return `union(${c.members.map(fmtConstraint).join(", ")})`;
  // shape({ x: …, y?: … })（isOptional 字段加 ?）
  if (c.fields) {
    const fs = Object.entries(c.fields).map(([k, f]) => {
      const opt = f.optional || f.constraint.isOptional ? "?" : "";
      return `${k}${opt}: ${fmtConstraint(f.constraint)}`;
    });
    return `shape({ ${fs.join(", ")} })`;
  }
  // array(…)
  if (c.element) return `array(${fmtConstraint(c.element)})`;
  // lit(v)：prim + 单一 eq(self, v)（lit(null) 无 prim 也识别）
  if (
    c.preds.length === 1 &&
    c.preds[0]!.op === "eq" &&
    c.preds[0]!.a.op === "var" &&
    c.preds[0]!.b.op === "lit" &&
    !isIntFlag(c)
  ) {
    return `lit(${litToString(c.preds[0]!.b.value)})`;
  }
  // 标量链：prim() + .int() + 逐 pred 链段（+ .optional()）
  let out =
    c.prim !== undefined ? `${c.prim}()` : c.preds.length > 0 ? "number()" : "any()";
  if (isIntFlag(c)) out += ".int()";
  for (const p of c.preds) out += predToChain(p);
  if (c.isOptional) out += ".optional()";
  return out;
}

/** 组合式显示：重建构建器调用形态（number().gt(0) / union(…) / fn(…)） */
export function formatConstraint(c: NudoConstraint): string {
  return fmtConstraint(c);
}
