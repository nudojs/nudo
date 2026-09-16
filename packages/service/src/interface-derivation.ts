/**
 * Root 驱动的契约下行（design-refine-derivation §4.2 / §11 Phase 2）。
 *
 * 对含手写契约根的文件（lib.nudo.js 绑定 add4）：
 *   1. 从侧车 AST 抽出参数约束的源表达式（`positive` ← `./std.nudo.js`）；
 *   2. constraintToEntryAbs + tagDerivationRoot；
 *   3. analyzeFn 求值 body（模块图注入下游），收集调用记录 + 推导打点；
 *   4. 闭包内下游导出投影为组合式 DSL，禁止事后从 Abs 反编译链。
 *
 * check 分轨：每条 root 链独立；join 只用于工件聚合（多调用者）。
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { parse } from "@nudojs/parser";
import {
  analyzeFn,
  beginDerivationSession,
  constraintToEntryAbs,
  derivationChain,
  effectiveInterface,
  endDerivationSession,
  execNudoModule,
  formatConstraint,
  getDerivation,
  interfaceDiagCount,
  isNodeModulesPath,
  isNudoConstraint,
  joinThenProject,
  parseSource,
  projectDerivationDsl,
  refineDiagCount,
  setAbsCallCollector,
  sidecarPathOf,
  tagDerivationRoot,
  takeInterfaceDiagsSince,
  takeRefineDiagsSince,
  unknown as unknownAbs,
  type Abs,
  type AbsCallRecord,
  type DerivationNode,
  type NudoConstraint,
} from "@nudojs/core";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { findProjectConfig, interfaceConfig, matchesEmitAllowlist } from "./evaluator/config.ts";
import { unifiedDiff } from "./case-emitter.ts";

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

/** 从侧车源码抽出 `export const f = fn({ x: positive }, ret)` 的约束源表达式 */
export function extractFnConstraintSources(
  sidecarSrc: string,
  fnName: string,
): { params: Record<string, ConstraintSourceExpr>; returns?: ConstraintSourceExpr } {
  const out: {
    params: Record<string, ConstraintSourceExpr>;
    returns?: ConstraintSourceExpr;
  } = { params: {} };
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(sidecarSrc);
  } catch {
    return out;
  }

  const imports = new Map<string, { from: string; imported: string }>();
  const locals = new Map<string, string>();

  const srcOf = (node: unknown): ConstraintSourceExpr | undefined => {
    const n = node as {
      type?: string;
      name?: string;
      start?: number | null;
      end?: number | null;
    };
    if (!n?.type) return undefined;
    if (n.type === "Identifier" && n.name) {
      const imp = imports.get(n.name);
      if (imp) {
        return { expr: imp.imported, importFrom: imp.from, importName: imp.imported };
      }
      const local = locals.get(n.name);
      if (local !== undefined) return { expr: local };
      return { expr: n.name };
    }
    if (n.start != null && n.end != null) {
      return { expr: sidecarSrc.slice(n.start, n.end) };
    }
    return undefined;
  };

  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      const from = stmt.source.value;
      for (const s of stmt.specifiers) {
        if (s.type === "ImportSpecifier") {
          const imported =
            s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
          imports.set(s.local.name, { from, imported });
        }
      }
      continue;
    }
    if (stmt.type !== "ExportNamedDeclaration" || stmt.source) continue;
    const d = stmt.declaration;
    if (!d || d.type !== "VariableDeclaration") continue;
    for (const decl of d.declarations) {
      if (decl.id.type !== "Identifier") continue;
      const name = decl.id.name;
      const init = decl.init;
      if (!init) continue;
      const text =
        init.start != null && init.end != null
          ? sidecarSrc.slice(init.start, init.end)
          : name;
      if (init.type !== "CallExpression") {
        locals.set(name, text);
        continue;
      }
      const calleeName =
        init.callee.type === "Identifier" ? init.callee.name : undefined;
      locals.set(name, text);
      if (calleeName !== "fn" || name !== fnName) continue;
      const paramsNode = init.arguments[0];
      if (paramsNode?.type === "ObjectExpression") {
        for (const prop of paramsNode.properties) {
          if (prop.type !== "ObjectProperty") continue;
          const key =
            prop.key.type === "Identifier"
              ? prop.key.name
              : prop.key.type === "StringLiteral"
                ? prop.key.value
                : undefined;
          if (!key) continue;
          const expr = srcOf(prop.value);
          if (expr) out.params[key] = expr;
        }
      }
      const retNode = init.arguments[1];
      if (retNode) {
        const expr = srcOf(retNode);
        if (expr) out.returns = expr;
      }
    }
  }
  return out;
}

/** 形参名（函数声明 / const 箭头；export 包裹） */
export function functionParamNames(source: string, fnName: string): string[] {
  try {
    const ast = parse(source);
    for (const stmt of ast.program.body) {
      const d =
        stmt.type === "ExportNamedDeclaration" ? (stmt.declaration ?? undefined) : stmt;
      if (!d) continue;
      if (d.type === "FunctionDeclaration" && d.id?.name === fnName) {
        return d.params.map(paramNameOf);
      }
      if (d.type === "VariableDeclaration") {
        for (const decl of d.declarations) {
          if (
            decl.id.type === "Identifier" &&
            decl.id.name === fnName &&
            decl.init &&
            (decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression")
          ) {
            return decl.init.params.map(paramNameOf);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function paramNameOf(p: { type: string; name?: string; left?: { type: string; name?: string } }): string {
  if (p.type === "Identifier" && p.name) return p.name;
  if (p.type === "AssignmentPattern" && p.left?.type === "Identifier" && p.left.name) {
    return p.left.name;
  }
  return "_";
}

function topLevelFnNames(source: string): string[] {
  const out: string[] = [];
  try {
    const ast = parse(source);
    for (const stmt of ast.program.body) {
      const d =
        stmt.type === "ExportNamedDeclaration" ? (stmt.declaration ?? undefined) : stmt;
      if (!d) continue;
      if (d.type === "FunctionDeclaration" && d.id) out.push(d.id.name);
      if (d.type === "VariableDeclaration") {
        for (const decl of d.declarations) {
          if (
            decl.id.type === "Identifier" &&
            decl.init &&
            (decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression")
          ) {
            out.push(decl.id.name);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function importLocalMap(
  source: string,
  fromFile: string,
): Map<string, { modulePath: string; exportName: string }> {
  const out = new Map<string, { modulePath: string; exportName: string }>();
  try {
    const ast = parse(source);
    const base = dirname(resolve(fromFile));
    for (const stmt of ast.program.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      const spec = stmt.source.value;
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const raw = resolve(base, spec);
      let modulePath: string | null = null;
      for (const cand of [raw, `${raw}.js`, `${raw}.ts`, `${raw}.mjs`]) {
        if (existsSync(cand)) {
          modulePath = cand;
          break;
        }
      }
      if (!modulePath) continue;
      for (const s of stmt.specifiers) {
        if (s.type === "ImportSpecifier") {
          const imported =
            s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
          out.set(s.local.name, { modulePath, exportName: imported });
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function resolveRelImport(fromSpec: string, fromDir: string, targetDir: string): string {
  const abs = resolve(fromDir, fromSpec);
  let rel = relative(targetDir, abs);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.split("\\").join("/");
}

/**
 * 单参数位投影：单链走 derivation 组合式；多链先 join 再展开式。
 * 组合式时附带 rootNodeId/shiftCount，供返回位相对投影做结构匹配。
 */
function projectParamSlot(
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
function projectReturnSlot(
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
function projectReturnRelativeToParams(
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

type CallAgg = {
  targetFile: string;
  targetExport: string;
  argAbs: Abs[][];
  resultAbs: Abs[];
};

/**
 * 入口：对 filePath 做 root 驱动下行推导。
 */
export function deriveFromRoot(
  filePath: string,
  opts: RootDeriveOpts = {},
): RootDeriveResult {
  const abs = resolve(filePath);
  const source = readFileSync(abs, "utf-8");
  const since = interfaceDiagCount();
  const autoBind =
    opts.autoBind ?? interfaceConfig(findProjectConfig(dirname(abs))?.config).autoBind;
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const sidecarPath = sidecarPathOf(abs);
  const sidecarSrc =
    existsSync(sidecarPath) && !isNodeModulesPath(sidecarPath)
      ? readFileSync(sidecarPath, "utf-8")
      : "";

  const fnNames = topLevelFnNames(source);
  const roots: string[] = [];
  const plans: Array<{
    fnName: string;
    params: Array<{ name: string; constraint: NudoConstraint; src?: ConstraintSourceExpr }>;
  }> = [];

  for (const fn of fnNames) {
    const eff = effectiveInterface(source, fn, { loadModule, fromFile: abs, autoBind });
    if (!eff || eff.source !== "handwritten") continue;
    roots.push(fn);
    const sources = sidecarSrc
      ? extractFnConstraintSources(sidecarSrc, fn)
      : { params: {} };
    const srcParams = functionParamNames(source, fn);
    const planParams = srcParams.map((pname) => {
      const hit = eff.params.find((p) => p.param === pname);
      if (hit) {
        const src = sources.params[pname];
        return {
          name: pname,
          constraint: hit.constraint,
          ...(src ? { src } : {}),
        };
      }
      return {
        name: pname,
        constraint: { __nudoConstraint: true, preds: [] } as NudoConstraint,
      };
    });
    plans.push({ fnName: fn, params: planParams });
  }

  if (plans.length === 0) {
    takeInterfaceDiagsSince(since);
    return { roots: [], derived: [], hasRoot: false };
  }

  let modules: Record<string, import("@nudojs/core").AbsModuleExports> = {};
  try {
    modules = evalAbsModuleGraph(source, abs, { loadModule }).modules;
  } catch {
    modules = {};
  }
  const importLocals = importLocalMap(source, abs);
  const wanted =
    opts.fnNames && opts.fnNames.length > 0 ? new Set(opts.fnNames) : undefined;

  const derived: DerivedExport[] = [];

  for (const plan of plans) {
    // 展示口径：cwd 相对（cwd 外用 basename），避免 /tmp fixture 出现 ../../ 链
    const relRoot = relative(process.cwd(), abs);
    const label = `${relRoot === "" || relRoot.startsWith("..") ? basename(abs) : relRoot}:${plan.fnName}`;
    const rows = deriveOneRoot(plan, source, abs, modules, importLocals, label);
    for (const row of rows) {
      if (wanted && !wanted.has(row.fn)) continue;
      derived.push(row);
    }
  }

  takeInterfaceDiagsSince(since);
  return { roots, derived, hasRoot: true };
}

function deriveOneRoot(
  plan: {
    fnName: string;
    params: Array<{ name: string; constraint: NudoConstraint; src?: ConstraintSourceExpr }>;
  },
  source: string,
  file: string,
  modules: Record<string, import("@nudojs/core").AbsModuleExports>,
  importLocals: Map<string, { modulePath: string; exportName: string }>,
  label: string,
): DerivedExport[] {
  beginDerivationSession();
  const entryArgs: Abs[] = [];
  try {
    for (const p of plan.params) {
      const entry = constraintToEntryAbs(p.constraint, p.name);
      if (p.src) {
        tagDerivationRoot(entry, {
          expr: p.src.expr,
          ...(p.src.importFrom !== undefined ? { importFrom: p.src.importFrom } : {}),
          ...(p.src.importName !== undefined ? { importName: p.src.importName } : {}),
        });
      } else if (p.constraint.preds.length === 0 && !p.constraint.prim) {
        // 无约束占位：用 unknown，不打 root
      }
      entryArgs.push(entry);
    }

    const calls: AbsCallRecord[] = [];
    const prevCallCollector = setAbsCallCollector((r) => calls.push(r));
    try {
      analyzeFn(source, plan.fnName, entryArgs, undefined, undefined, undefined, modules);
    } catch {
      return [];
    } finally {
      setAbsCallCollector(prevCallCollector);
    }

    const byCallee = new Map<string, CallAgg>();
    for (const call of calls) {
      const imp = importLocals.get(call.fnName);
      let targetFile: string;
      let targetExport = call.fnName;
      if (imp) {
        targetFile = imp.modulePath;
        targetExport = imp.exportName;
      } else {
        targetFile = file;
      }
      if (isNodeModulesPath(targetFile)) continue;
      if (!existsSync(targetFile)) continue;
      const key = `${targetFile}::${targetExport}`;
      let agg = byCallee.get(key);
      if (!agg) {
        agg = { targetFile, targetExport, argAbs: [], resultAbs: [] };
        byCallee.set(key, agg);
      }
      agg.argAbs.push(call.args);
      agg.resultAbs.push(call.threw ? unknownAbs : call.result);
    }

    const out: DerivedExport[] = [];
    for (const agg of byCallee.values()) {
      let targetSource: string;
      try {
        targetSource = readFileSync(agg.targetFile, "utf-8");
      } catch {
        continue;
      }
      const paramNames = functionParamNames(targetSource, agg.targetExport);
      if (paramNames.length === 0 && agg.argAbs.every((a) => a.length === 0)) continue;

      const width = Math.max(
        paramNames.length,
        ...agg.argAbs.map((a) => a.length),
        0,
      );
      const params: DerivedParam[] = [];
      let allCompositional = true;
      let sawEvidence = false;

      for (let i = 0; i < width; i++) {
        const name = paramNames[i] ?? `_${i}`;
        const absList: Abs[] = [];
        for (const args of agg.argAbs) {
          const a = args[i];
          if (a) absList.push(a);
        }
        const slot = projectParamSlot(absList, name);
        if (!slot) {
          allCompositional = false;
          continue;
        }
        sawEvidence = true;
        if (!slot.compositional) allCompositional = false;
        params.push({
          name,
          constraint: slot.constraint,
          dsl: slot.dsl,
          prelude: slot.prelude,
          imports: slot.imports,
          ...(slot.rootNodeId !== undefined ? { rootNodeId: slot.rootNodeId } : {}),
          ...(slot.shiftCount !== undefined ? { shiftCount: slot.shiftCount } : {}),
        });
      }

      const retAbs = agg.resultAbs.filter(
        (a) => a.conf === "exact" || a.conf === "path",
      );
      const retSlot = projectReturnSlot(retAbs, params, paramNames);
      if (retSlot && !retSlot.compositional) allCompositional = false;
      if (retSlot) sawEvidence = true;

      if (!sawEvidence) {
        out.push({
          file: agg.targetFile,
          fn: agg.targetExport,
          paramNames,
          params: [],
          derivedFrom: label,
          compositional: false,
          underivable: true,
        });
        continue;
      }

      out.push({
        file: agg.targetFile,
        fn: agg.targetExport,
        paramNames,
        params,
        ...(retSlot
          ? {
              returns: {
                constraint: retSlot.constraint,
                dsl: retSlot.dsl,
                prelude: retSlot.prelude,
                imports: retSlot.imports,
              },
            }
          : {}),
        derivedFrom: label,
        compositional: allCompositional && params.length > 0,
      });
    }
    return out;
  } finally {
    endDerivationSession();
  }
}

/** 侧车顶层已占用标识符 → 新段 local / import 名避让 */
class NameAllocator {
  private readonly taken: Set<string>;
  constructor(initial?: Iterable<string>) {
    this.taken = new Set(initial ?? []);
  }
  claim(preferred: string): string {
    if (!this.taken.has(preferred)) {
      this.taken.add(preferred);
      return preferred;
    }
    let i = 2;
    while (this.taken.has(`${preferred}_${i}`)) i++;
    const name = `${preferred}_${i}`;
    this.taken.add(name);
    return name;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 整词替换标识符（避免 `x` 误伤 `x_0` / 属性 `.x`） */
function rewriteIdents(src: string, map: Map<string, string>): string {
  if (map.size === 0) return src;
  let out = src;
  // 长名优先，避免 `x` 先替换破坏 `x_0`
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const v = map.get(k)!;
    if (k === v) continue;
    out = out.replace(new RegExp(`(?<![\\w$.])${escapeRegExp(k)}(?![\\w$])`, "g"), v);
  }
  return out;
}

function preludeLocalName(line: string): string | undefined {
  const m = /^const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line.trim());
  return m?.[1];
}

/**
 * 组装生成段（组合式 + import + prelude）。
 * importFrom 相对 root 侧车解析，再相对 target 侧车写出。
 *
 * `takenNames`：侧车顶层已占用标识符（手写 / 既有生成段 / 本批先前段）。
 * 同文件多导出时对 import local 与 prelude local 做避让改写，
 * 保证拼出的侧车在模块作用域内无重复声明。
 */
export function formatDerivedSection(
  row: DerivedExport,
  opts: {
    rootSidecarDir: string;
    targetSidecarDir: string;
    takenNames?: Iterable<string>;
  },
): { text: string; usedNames: string[] } | undefined {
  if (row.underivable || row.params.length === 0) return undefined;
  const importMap = new Map<string, string>(); // original name → resolved path
  const preludes: string[] = [];
  const paramDsls: string[] = [];

  for (const p of row.params) {
    for (const imp of p.imports) {
      const rel = resolveRelImport(imp.from, opts.rootSidecarDir, opts.targetSidecarDir);
      const prev = importMap.get(imp.name);
      if (prev !== undefined && prev !== rel) return undefined;
      importMap.set(imp.name, rel);
    }
    for (const line of p.prelude) {
      if (!preludes.includes(line)) preludes.push(line);
    }
    paramDsls.push(p.dsl);
  }

  let retDsl = "";
  if (row.returns) {
    for (const imp of row.returns.imports) {
      const rel = resolveRelImport(imp.from, opts.rootSidecarDir, opts.targetSidecarDir);
      const prev = importMap.get(imp.name);
      // 与参数位同口径：同名不同路径 → 本段不可投影（禁止静默覆盖）
      if (prev !== undefined && prev !== rel) return undefined;
      importMap.set(imp.name, rel);
    }
    for (const line of row.returns.prelude) {
      if (!preludes.includes(line)) preludes.push(line);
    }
    retDsl = `, ${row.returns.dsl}`;
  }

  // ---- 名字分配：先占 export 名，再 import local，再 prelude local ----
  const namer = new NameAllocator(opts.takenNames);
  namer.claim(row.fn);
  const renames = new Map<string, string>();
  const importLocals: Array<{ original: string; local: string; from: string }> = [];
  for (const [name, from] of [...importMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const local = namer.claim(name);
    if (local !== name) renames.set(name, local);
    importLocals.push({ original: name, local, from });
  }

  const preludeClaimed = new Set<string>();
  const renamedPreludes: string[] = [];
  for (const line of preludes) {
    const local = preludeLocalName(line);
    if (local !== undefined && !preludeClaimed.has(local)) {
      preludeClaimed.add(local);
      if (!renames.has(local)) {
        const next = namer.claim(local);
        if (next !== local) renames.set(local, next);
      }
    }
    renamedPreludes.push(rewriteIdents(line, renames));
  }

  // `{ x }` shorthand when rewritten dsl matches rewritten param-local binding
  const paramParts = row.params.map((p, i) => {
    const dsl = rewriteIdents(paramDsls[i]!, renames);
    const name = rewriteIdents(p.name, renames);
    return dsl === name ? name : `${name}: ${dsl}`;
  });
  const retPart = retDsl === "" ? "" : `, ${rewriteIdents(row.returns!.dsl, renames)}`;

  const importLineTexts = importLocals
    .map(({ original, local, from }) => {
      const spec = original === local ? local : `${original} as ${local}`;
      return `import { ${spec} } from ${JSON.stringify(from)};`;
    })
    .sort((a, b) => a.localeCompare(b));

  const lines = [
    ...importLineTexts,
    ...(importLineTexts.length > 0 && renamedPreludes.length > 0 ? [""] : []),
    ...renamedPreludes,
    `export const ${row.fn} = fn({ ${paramParts.join(", ")} }${retPart});`,
  ];

  const usedNames = new Set<string>();
  for (const { local } of importLocals) usedNames.add(local);
  for (const line of renamedPreludes) {
    const n = preludeLocalName(line);
    if (n) usedNames.add(n);
  }
  usedNames.add(row.fn);

  return { text: lines.join("\n"), usedNames: [...usedNames] };
}

// ---------------------------------------------------------------------------
// Root 驱动多文件写盘（§7.3：emit 永远 root 驱动；下游随根 emit 一并更新）
// ---------------------------------------------------------------------------

export type EmitDerivedResult = {
  /** 被写/将写的下游侧车（绝对路径） */
  sidecars: Array<{
    file: string;
    sidecarPath: string;
    fn: string;
    written: boolean;
    changed: boolean;
    skipped?: "name-clash" | "not-projectable" | "underivable" | "no-change";
    diff?: string;
    issues: Array<{ code: string; severity: "error" | "warning" | "info"; message: string }>;
  }>;
  hasRoot: boolean;
  roots: string[];
  /** 根在别处 / 无契约根且无已存在生成段 → info */
  entryOnly?: boolean;
};

const DERIVED_HEADER =
  "// @generated by nudo — do not edit; regenerate with `nudo interface --emit`";

/**
 * Root 驱动 emit：对 rootFile 的手写契约根做下行推导，把闭包内被点名的
 * 下游导出写入**各自**的 `*.nudo.js`（§7.3 / §11 Phase 2 验收：
 * `--emit src/lib.js --fn add2` 只写 add.nudo.js 的 add2）。
 *
 * 手写绑定永不覆盖；round-trip 自检失败不写垃圾。
 */
/**
 * 侧车顶层标识符（import local / 顶层声明 / export 名）。
 * 新生成段据此避让，避免同文件重复 `const x` / 重复 import 绑定。
 */
function collectTopLevelNames(src: string): Set<string> {
  const names = new Set<string>();
  if (src.trim() === "") return names;
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return names;
  }
  const addDecl = (d: ReturnType<typeof parseSource>["program"]["body"][number]): void => {
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier") names.add(decl.id.name);
      }
    } else if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      if (d.id) names.add(d.id.name);
    }
  };
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      for (const s of stmt.specifiers) names.add(s.local.name);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) addDecl(stmt.declaration);
      for (const spec of stmt.specifiers) {
        names.add(
          spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value,
        );
      }
      continue;
    }
    addDecl(stmt);
  }
  return names;
}

function sidecarAssembles(text: string, fromFile: string, loadModule: LoadModule): boolean {
  try {
    parseSource(text);
    execNudoModule(text, { loadModule, fromFile });
    return true;
  } catch {
    return false;
  }
}

export function emitDerivedFromRoot(
  rootFile: string,
  opts: {
    fnNames?: string[];
    mode: "add" | "update";
    dryRun?: boolean;
    loadModule?: LoadModule;
    autoBind?: boolean;
    /** 只刷新目标侧车里已存在的 @generated 段（不发明新下游契约） */
    refreshExistingOnly?: boolean;
  },
): EmitDerivedResult {
  const abs = resolve(rootFile);
  const derive = deriveFromRoot(abs, {
    ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
    ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    ...(opts.fnNames && opts.fnNames.length > 0 ? { fnNames: opts.fnNames } : {}),
  });

  if (!derive.hasRoot) {
    return { sidecars: [], hasRoot: false, roots: [], entryOnly: true };
  }

  // package.json#nudo.interface.emit 白名单（Phase 3 §7.3）
  const proj = findProjectConfig(dirname(abs));
  const allow = interfaceConfig(proj?.config).emit;
  const projectDir = proj?.projectDir;

  const rootSidecarDir = dirname(sidecarPathOf(abs));
  const wanted =
    opts.fnNames && opts.fnNames.length > 0 ? new Set(opts.fnNames) : undefined;

  const result: EmitDerivedResult = {
    sidecars: [],
    hasRoot: true,
    roots: derive.roots,
  };

  // 按目标侧车分组（同文件多导出一次读写）
  const bySidecar = new Map<string, typeof derive.derived>();
  for (const row of derive.derived) {
    if (wanted && !wanted.has(row.fn)) continue;
    if (!matchesEmitAllowlist(row.file, projectDir, allow)) continue;
    const sp = sidecarPathOf(row.file);
    if (isNodeModulesPath(sp)) continue;
    const list = bySidecar.get(sp) ?? [];
    list.push(row);
    bySidecar.set(sp, list);
  }

  for (const [sidecarPath, rows0] of bySidecar) {
    const targetFile = rows0[0]!.file;
    const targetSidecarDir = dirname(sidecarPath);
    const prevSrc = existsSync(sidecarPath) ? readFileSync(sidecarPath, "utf-8") : "";

    // refreshExistingOnly：只碰已有生成段的导出，不发明新契约
    const rows = opts.refreshExistingOnly
      ? rows0.filter((r) => findGeneratedSectionText(prevSrc, r.fn) !== undefined)
      : rows0;
    if (rows.length === 0) continue;

    // 手写绑定名（顶层声明 − 生成段）
    const handwritten = handwrittenNames(prevSrc);
    const loadModule = opts.loadModule ?? defaultLoadModule;

    // update：剥离「本批可能重写」的生成段后收集残留顶层名；format 失败的
    // 段会保留旧文，其名字在失败时回填 taken（避免新段抢占）。
    const batchFns = new Set(
      rows.filter((r) => !r.underivable && !handwritten.has(r.fn)).map((r) => r.fn),
    );
    const baseForNames =
      opts.mode === "update" ? stripGeneratedFor(prevSrc, batchFns) : prevSrc;
    const taken = collectTopLevelNames(baseForNames);

    const accepted: Array<{ fn: string; text: string; prevText?: string }> = [];
    const issues: EmitDerivedResult["sidecars"][number]["issues"] = [];
    const written: string[] = [];
    let anySkip: EmitDerivedResult["sidecars"][number]["skipped"];

    for (const row of rows) {
      if (handwritten.has(row.fn)) {
        issues.push({
          code: "nudo:interface-name-clash",
          severity: "error",
          message: `sidecar already has a handwritten binding '${row.fn}' (${relative(process.cwd(), sidecarPath) || sidecarPath}); handwritten wins — skipping emit`,
        });
        anySkip = "name-clash";
        continue;
      }
      if (row.underivable) {
        issues.push({
          code: "nudo:interface-underivable",
          severity: "info",
          message: `${row.fn}: contract underivable from ${row.derivedFrom} (opaque / truncated / no evidence)`,
        });
        anySkip = "underivable";
        continue;
      }
      const prevSection = findGeneratedSectionText(prevSrc, row.fn);
      const body = formatDerivedSection(row, {
        rootSidecarDir,
        targetSidecarDir,
        takenNames: taken,
      });
      if (!body) {
        anySkip = "not-projectable";
        // 旧段将原样保留 → 名字继续占用
        if (prevSection !== undefined) {
          for (const n of collectTopLevelNames(prevSection)) taken.add(n);
        }
        continue;
      }
      for (const n of body.usedNames) taken.add(n);
      const srcRel = relative(targetSidecarDir, targetFile) || basename(targetFile);
      const section = [
        DERIVED_HEADER,
        `// source: ${srcRel}:${row.fn}`,
        `// derived-from: ${row.derivedFrom}`,
        body.text,
        "",
      ].join("\n");

      // round-trip：整段（含 import）必须可执行——fromFile 用目标侧车路径，
      // 相对 spec（./std.nudo.js）按该目录解析
      if (!derivedRoundTrips(section, row.fn, sidecarPath, loadModule)) {
        anySkip = "not-projectable";
        if (prevSection !== undefined) {
          for (const n of collectTopLevelNames(prevSection)) taken.add(n);
        }
        continue;
      }

      if (opts.mode === "add" && prevSection !== undefined) {
        anySkip = "no-change";
        for (const n of collectTopLevelNames(prevSection)) taken.add(n);
        continue;
      }
      const norm = normalizeSectionText(section);
      if (prevSection !== undefined && normalizeSectionText(prevSection) === norm) {
        anySkip = "no-change";
        accepted.push({ fn: row.fn, text: prevSection, prevText: prevSection });
        for (const n of collectTopLevelNames(prevSection)) taken.add(n);
        continue;
      }
      written.push(row.fn);
      accepted.push({ fn: row.fn, text: section, ...(prevSection !== undefined ? { prevText: prevSection } : {}) });
    }

    // 组装：update 只剥离**已接受**的生成段；underivable/not-projectable/
    // name-clash 的既有段原样保留（证据退化不静默删契约）。
    // accepted 为空时必须原样保留——否则 stripped=prev + preserved 会叠层。
    let finalContent: string;
    if (accepted.length === 0) {
      finalContent = prevSrc;
    } else if (opts.mode === "add") {
      finalContent = joinSectionTexts(prevSrc, accepted.map((a) => a.text));
    } else {
      const acceptedFns = new Set(accepted.map((a) => a.fn));
      const stripped = stripGeneratedFor(prevSrc, acceptedFns);
      const preserved = collectGeneratedSectionsRaw(prevSrc).filter(
        (s) => !s.names.some((n) => acceptedFns.has(n)),
      );
      finalContent = joinSectionTexts(stripped, [
        ...preserved.map((s) => normalizeSectionText(s.text)),
        ...accepted.map((a) => a.text),
      ]);
    }

    // 整文件 round-trip：同侧车多段拼装后仍必须是合法可执行模块
    // （单段自检挡不住 duplicate import / const 重定义）
    if (finalContent.trim() !== "" && !sidecarAssembles(finalContent, sidecarPath, loadModule)) {
      issues.push({
        code: "nudo:interface-not-projectable",
        severity: "error",
        message: `assembled sidecar failed round-trip (${relative(process.cwd(), sidecarPath) || sidecarPath}); refusing to write`,
      });
      anySkip = "not-projectable";
      result.sidecars.push({
        file: targetFile,
        sidecarPath,
        fn: rows.map((r) => r.fn).join(","),
        written: false,
        changed: false,
        ...(anySkip ? { skipped: anySkip } : {}),
        issues,
      });
      continue;
    }

    const changed = finalContent !== prevSrc;
    const diff = changed
      ? unifiedDiff(prevSrc, finalContent, relative(process.cwd(), sidecarPath) || sidecarPath)
      : undefined;

    if (changed && !opts.dryRun) {
      const tmp = `${sidecarPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
      try {
        writeFileSync(tmp, finalContent, "utf-8");
        renameSync(tmp, sidecarPath);
      } catch (e) {
        try {
          if (existsSync(tmp)) unlinkSync(tmp);
        } catch {
          /* best-effort */
        }
        throw e;
      }
    }

    result.sidecars.push({
      file: targetFile,
      sidecarPath,
      fn: rows.map((r) => r.fn).join(","),
      written: written.length > 0 && changed,
      changed,
      ...(anySkip ? { skipped: anySkip } : {}),
      ...(diff !== undefined ? { diff } : {}),
      issues,
    });
  }

  return result;
}

// --- 侧车段工具（与 interface-emitter 同口径，独立实现避免循环依赖）---

type RawSection = { names: string[]; start: number; end: number; text: string };

function collectGeneratedSectionsRaw(src: string): RawSection[] {
  if (src.trim() === "") return [];
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return [];
  }
  const stmts = ast.program.body;
  const out: RawSection[] = [];
  // 从 @generated 注释行起，到其后第一个顶层 export 止——中间允许
  // import / prelude const（组合式 §5.3 形态）。
  for (const headerPos of findGeneratedHeaderOffsets(src)) {
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]!;
      if (stmt.type !== "ExportNamedDeclaration" || stmt.source) continue;
      if (stmt.start == null || stmt.end == null || stmt.start < headerPos) continue;
      const d = stmt.declaration;
      if (!d) continue;
      const names: string[] = [];
      if (d.type === "VariableDeclaration") {
        for (const decl of d.declarations) {
          if (decl.id.type === "Identifier") names.push(decl.id.name);
        }
      } else if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
        if (d.id) names.push(d.id.name);
      }
      if (names.length === 0) continue;
      out.push({
        names,
        start: headerPos,
        end: stmt.end,
        text: src.slice(headerPos, stmt.end),
      });
      break;
    }
  }
  return out;
}

/** 注释行上的 `@generated` 字节偏移（段起点） */
function findGeneratedHeaderOffsets(src: string): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (
      (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) &&
      /@generated/.test(t)
    ) {
      out.push(pos);
    }
    pos += line.length + 1;
  }
  return out;
}

function generatedSectionNames(src: string): Set<string> {
  return new Set(collectGeneratedSectionsRaw(src).flatMap((s) => s.names));
}

function handwrittenNames(src: string): Set<string> {
  if (src.trim() === "") return new Set();
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return new Set();
  }
  const names = new Set<string>();
  const collect = (stmt: ReturnType<typeof parseSource>["program"]["body"][number]): void => {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier") names.add(d.id.name);
      }
    } else if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") {
      if (stmt.id) names.add(stmt.id.name);
    }
  };
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) collect(stmt.declaration);
      if (!stmt.source) {
        for (const spec of stmt.specifiers) {
          names.add(
            spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value,
          );
        }
      }
    } else {
      collect(stmt);
    }
  }
  // 生成段名不算手写
  for (const n of generatedSectionNames(src)) names.delete(n);
  return names;
}

function findGeneratedSectionText(src: string, fn: string): string | undefined {
  return collectGeneratedSectionsRaw(src).find((s) => s.names.includes(fn))?.text;
}

function stripGeneratedFor(src: string, fns: Set<string>): string {
  const sections = collectGeneratedSectionsRaw(src).filter((s) =>
    s.names.some((n) => fns.has(n)),
  );
  if (sections.length === 0) return src;
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const s of sorted) {
    out += src.slice(pos, s.start);
    pos = Math.max(pos, s.end);
  }
  out += src.slice(pos);
  return out;
}

function normalizeSectionText(text: string): string {
  return text.replace(/\s*$/, "") + "\n";
}

function joinSectionTexts(base: string, sectionTexts: string[]): string {
  const normalized = sectionTexts.map(normalizeSectionText).filter((t) => t.trim() !== "");
  const tailTrimmed = base.replace(/\s+$/, "");
  if (normalized.length === 0) return tailTrimmed === "" ? "" : `${tailTrimmed}\n`;
  const trimmed = tailTrimmed.replace(/^\s+/, "");
  const lead = trimmed === "" ? "" : `${trimmed}\n\n`;
  return lead + normalized.join("\n");
}

function derivedRoundTrips(
  text: string,
  fn: string,
  fromFile: string,
  loadModule: LoadModule,
): boolean {
  const since = refineDiagCount();
  try {
    const exports = execNudoModule(text, { loadModule, fromFile });
    const v = exports[fn];
    return isNudoConstraint(v) && (v as { fn?: unknown }).fn !== undefined;
  } catch {
    return false;
  } finally {
    takeRefineDiagsSince(since);
  }
}
