/**
 * Root 驱动推导（extract 侧车约束源 → deriveFromRoot / deriveOneRoot）。
 * 自 interface-derivation.ts 机械拆出；语义未改。
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { parse } from "@nudojs/parser";
import {
  constraintToEntryAbs,
  effectiveInterface,
  interfaceDiagCount,
  isNodeModulesPath,
  runTranspiled,
  callTranspiledExportFull,
  setBCallCollector,
  $new,
  $invoke,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  unknown as unknownAbs,
  type Abs,
  type AbsCallRecord,
  type BCallRecord,
  type NudoConstraint,
} from "@nudojs/core";
import {
  beginDerivationSession,
  endDerivationSession,
  listTopFunctions,
  tagDerivationRoot,
} from "@nudojs/core/internal";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";
import { defaultLoadModule } from "./load-module.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";
import {
  projectParamSlot,
  projectReturnSlot,
  type ConstraintSourceExpr,
  type DerivedExport,
  type DerivedParam,
  type RootDeriveOpts,
  type RootDeriveResult,
} from "./interface-derivation-project.ts";

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

/** 形参名（函数声明 / const 箭头 / Class.method；export 包裹） */
export function functionParamNames(source: string, fnName: string): string[] {
  try {
    const ast = parse(source);
    // C4.2：`Class.method` → class 成员形参（跳过 ctor/get/set）
    if (fnName.includes(".")) {
      const [clsName, methodName] = fnName.split(".", 2);
      for (const stmt of ast.program.body) {
        let decl: unknown =
          stmt.type === "ExportNamedDeclaration"
            ? (stmt as { declaration?: unknown }).declaration
            : stmt;
        if (!decl) continue;
        if ((decl as { type?: string }).type === "ExportDefaultDeclaration") {
          decl = (decl as { declaration?: unknown }).declaration;
        }
        const c = decl as {
          type?: string;
          id?: { name?: string };
          body?: { body?: unknown[] };
        };
        if (c.type !== "ClassDeclaration" || c.id?.name !== clsName) continue;
        for (const m of c.body?.body ?? []) {
          const mem = m as {
            type?: string;
            kind?: string;
            static?: boolean;
            key?: { type?: string; name?: string };
            params?: unknown[];
          };
          const isMethod =
            mem.type === "MethodDefinition" ||
            mem.type === "ClassMethod" ||
            mem.type === "ClassPrivateMethod";
          if (!isMethod) continue;
          if (mem.kind && mem.kind !== "method") continue;
          const keyName = mem.key?.type === "Identifier" ? mem.key.name : undefined;
          if (keyName === methodName) {
            return ((mem.params as Array<{ type: string; name?: string; left?: { type: string; name?: string } }>) ?? []).map(
              paramNameOf,
            );
          }
        }
      }
      return [];
    }
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
  // 与 core scan.listTopFunctions 对齐：含 C4.2 导出 class 的 `Class.method`
  try {
    return listTopFunctions(source);
  } catch {
    return [];
  }
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
    const bCalls: BCallRecord[] = [];
    const prevCall = setBCallCollector((r) => bCalls.push(r));
    try {
      // B-path 优先（迁移件 3）：derivation 打点在共享代数层（arithmetic.add
      // noteDerivationAdd / joinAbs noteDerivationJoin），$add/$join 执行
      // 时自动打点——无需 transpile 插桩。类方法（.名）走类方法桥
      // （与 generalize 同轨：$new + $invoke），不再 fail-closed 跳过。
      {
        const run = runTranspiled(source, { mode: "analyze", modules });
        if (plan.fnName.includes(".")) {
          const [clsName, methodName] = plan.fnName.split(".", 2);
          const clsAbs = run[clsName ?? ""];
          if (clsAbs && typeof clsAbs === "object" && "shape" in (clsAbs as object)) {
            // ctor 形参个数对推导不敏感：统一 any 占位（generalize 同口径精神）
            const inst = $new(clsAbs as Abs, []);
            $invoke(inst, methodName ?? "", entryArgs);
          }
        } else if (plan.fnName in run) {
          callTranspiledExportFull(run, plan.fnName, entryArgs);
        }
        calls.push(
          ...bCalls.map((r) => ({
            fnName: r.fnName,
            args: r.args,
            result: r.result,
            callLoc: r.callLoc,
            threw: r.threw,
          })),
        );
      }
    } catch {
      return [];
    } finally {
      setBCallCollector(prevCall);
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


