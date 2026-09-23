import { readFileSync, statSync } from "node:fs";
import ts from "typescript";
import {
  type Abs,
  type Slot,
  abs as makeAbs,
  lit as termLit,
  v as termVar,
  numLit,
  strLit,
  boolLit,
  objOf,
  joinAbs,
  relationFn,
  getFnImpl,
} from "@nudojs/core";

/**
 * Harvested env：Abs 原生（与 EnvDefinition 同形）。
 * 收集与物化全程 Abs，不再经 TypeValue 桥。
 */
export type HarvestedEnv = {
  globals: Record<string, Abs>;
  modules: Record<string, Record<string, Abs>>;
  stats: { files: number; symbols: number; skipped: number };
};

type NamedTypeDecl = ts.InterfaceDeclaration | ts.ClassDeclaration;

/**
 * Runtime symbol collected in phase 1, materialized to an Abs in phase 2
 * once the whole symbol table is populated (cross-file references resolve
 * regardless of file order).
 */
type PendingSymbol =
  | { t: "fn"; scope: Scope; name: string; decls: ts.SignatureDeclaration[] }
  | { t: "var"; scope: Scope; name: string; typeNode?: ts.TypeNode }
  /** class / value-position interface re-export; `lookup` is the symbol-table name when the exported name differs */
  | { t: "value"; scope: Scope; name: string; lookup?: string }
  | { t: "enum"; scope: Scope; name: string }
  /**
   * 值位置接口展开（lodash `const _: _.LoDashStatic` 等）。
   * **推迟到 materialize**：interface 会跨文件 augmentation，
   * collect 期展开会只看到空的首个声明。
   */
  | { t: "iface-expand"; scope: Scope; localName: string; typeRefName: string };

interface HarvestContext {
  globals: Record<string, Abs>;
  modules: Record<string, Record<string, Abs>>;
  /** simple name → interface/class declarations (merged across augmentations) */
  interfaces: Map<string, NamedTypeDecl[]>;
  /** dotted name ("NodeJS.Process") → declarations (merged) */
  qualifiedInterfaces: Map<string, NamedTypeDecl[]>;
  /** simple name → type alias declarations (merged) */
  aliases: Map<string, ts.TypeAliasDeclaration[]>;
  /** dotted name → type alias declarations (merged) */
  qualifiedAliases: Map<string, ts.TypeAliasDeclaration[]>;
  /** simple name → class declaration (runtime values, for `export { X }` re-exports) */
  classes: Map<string, ts.ClassDeclaration>;
  instanceCache: Map<string, Abs>;
  expanding: Set<string>;
  /** 当前签名作用域内的泛型形参名（T/U…）→ 映射为 var Abs */
  typeParams: Set<string>;
  /** [aliasModule, targetModule] pairs from `export * from` / `export = x` forms */
  moduleAliases: Array<[alias: string, target: string]>;
  /** `import x = require("mod")` bindings, per scope key */
  importEquals: Map<string, Map<string, string>>;
  declaredModules: Set<string>;
  pending: PendingSymbol[];
  symbols: number;
  skipped: number;
}

interface Scope {
  /** enclosing `declare module "..."` name, or undefined for global scope */
  moduleName: string | undefined;
  /** enclosing namespace chain, e.g. ["NodeJS"] */
  ns: string[];
}

const MAX_ALIAS_DEPTH = 8;

function scopeKey(scope: Scope): string {
  return scope.moduleName ?? "\0global";
}

// --- Abs construction helpers ---

function absExact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}

function absNever(): Abs {
  return absExact({ k: "never" });
}

function absUnknown(): Abs {
  // unknown → conf partial
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}

function absPrim(type: "number" | "string" | "boolean" | "bigint" | "symbol"): Abs {
  return absExact({ k: "prim", type });
}

function absNullLit(): Abs {
  return makeAbs({ k: "unknown" }, termLit(null), undefined, "exact");
}

function absUndefLit(): Abs {
  return makeAbs({ k: "unknown" }, termLit(undefined), undefined, "exact");
}

function absLit(value: string | number | boolean | bigint | null | undefined): Abs {
  if (typeof value === "number") return numLit(value);
  if (typeof value === "string") return strLit(value);
  if (typeof value === "boolean") return boolLit(value);
  if (typeof value === "bigint") return absPrim("bigint");
  if (value === null) return absNullLit();
  return absUndefLit();
}

function absArr(element: Abs): Abs {
  return absExact({ k: "arr", element });
}

function absTuple(elements: Abs[]): Abs {
  return absExact({ k: "tuple", elements });
}

function absPromise(inner: Abs): Abs {
  return absExact({ k: "eff", eff: "promise", inner });
}

function absObj(properties: Record<string, Abs>): Abs {
  const slots: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(properties)) {
    slots[k] = { value: v };
  }
  return objOf(slots);
}

function absBrand(name: string, properties: Record<string, Abs>): Abs {
  return absExact({ k: "brand", name, shape: absObj(properties) });
}

function absFnSig(paramTypes: Abs[], returnType: Abs): Abs {
  // relationFn 双写 shape + impl.relation → 调用点 instantiateReturn 做 α 替换
  return relationFn(paramTypes, returnType, {
    params: paramTypes.map((_, i) => `_arg${i}`),
    conf: "exact",
  });
}

/** 泛型形参（T）→ 可被 α 替换的 var Abs */
function typeVarAbs(name: string): Abs {
  return makeAbs({ k: "any" }, termVar(name), undefined, "path");
}

/** multi-member union via binary join (drops never, absorbs lit into prim) */
function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absNever();
  return members.reduce((acc, m) => joinAbs(acc, m));
}

function isPlainUnknown(a: Abs): boolean {
  return a.shape.k === "unknown" && !(a.term?.op === "lit");
}

/** 含泛型 α（term var）——overload 合并时优先保留，避免 joinAbs 吞掉 T */
function hasTypeVar(a: Abs, depth = 0): boolean {
  if (depth > 6) return false;
  if (a.term?.op === "var") return true;
  const s = a.shape;
  if (s.k === "arr") return hasTypeVar(s.element, depth + 1);
  if (s.k === "tuple") return s.elements.some((e) => hasTypeVar(e, depth + 1));
  if (s.k === "sum") return s.members.some((m) => hasTypeVar(m, depth + 1));
  if (s.k === "obj") return Object.values(s.slots).some((sl) => hasTypeVar(sl.value, depth + 1));
  if (s.k === "fn") {
    return (s.paramTypes ?? []).some((p) => hasTypeVar(p, depth + 1)) ||
      (s.returnType ? hasTypeVar(s.returnType, depth + 1) : false);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function harvestDts(
  files: string[],
  opts?: { maxFileBytes?: number; maxMs?: number },
): HarvestedEnv {
  const maxBytes = opts?.maxFileBytes ?? 1_500_000;
  const deadline = opts?.maxMs !== undefined ? Date.now() + opts.maxMs : undefined;
  const ctx: HarvestContext = {
    globals: {},
    modules: {},
    interfaces: new Map(),
    qualifiedInterfaces: new Map(),
    aliases: new Map(),
    qualifiedAliases: new Map(),
    classes: new Map(),
    instanceCache: new Map(),
    expanding: new Set(),
    typeParams: new Set(),
    moduleAliases: [],
    importEquals: new Map(),
    declaredModules: new Set(),
    pending: [],
    symbols: 0,
    skipped: 0,
  };

  // Phase 1: collect declarations into the shared symbol table.
  let parsed = 0;
  for (const file of files) {
    if (deadline !== undefined && Date.now() > deadline) {
      ctx.skipped += files.length - parsed;
      break;
    }
    let content: string;
    try {
      const st = statSync(file);
      if (st.size > maxBytes) {
        ctx.skipped++;
        continue;
      }
      content = readFileSync(file, "utf8");
    } catch {
      ctx.skipped++;
      continue;
    }
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    collectStatements(ctx, sourceFile.statements, { moduleName: undefined, ns: [] });
    parsed++;
  }

  // Phase 2: materialize Abs with the complete symbol table available.
  materialize(ctx);

  return {
    globals: ctx.globals,
    modules: ctx.modules,
    stats: { files: parsed, symbols: ctx.symbols, skipped: ctx.skipped },
  };
}

export function emitEnvModule(env: HarvestedEnv, pkgName: string): string {
  // Module records can be shared (e.g. "fs" aliasing "node:fs"); emit those
  // once as a const and reference it under every key.
  const moduleEntries = Object.entries(env.modules);
  const keysByRecord = new Map<Record<string, Abs>, string[]>();
  for (const [moduleName, record] of moduleEntries) {
    const keys = keysByRecord.get(record);
    if (keys) keys.push(moduleName);
    else keysByRecord.set(record, [moduleName]);
  }
  const constNameByRecord = new Map<Record<string, Abs>, string>();
  const constLines: string[] = [];
  let constIndex = 0;
  for (const [record, keys] of keysByRecord) {
    if (keys.length < 2) continue;
    const constName = `mod${constIndex++}`;
    constNameByRecord.set(record, constName);
    constLines.push(`  const ${constName}: Record<string, unknown> = {`);
    emitEntries(constLines, record, 2);
    constLines.push(`  };`);
    constLines.push("");
  }

  const lines: string[] = [];
  lines.push("// Auto-generated by @nudojs/harvester — DO NOT EDIT");
  lines.push(`// Source package: ${pkgName}`);
  lines.push(
    'import { num, str, bool, never as absNever, unknown as absUnknown, numLit, strLit, boolLit, objOf, relationFn, abs as makeAbs } from "@nudojs/core";',
  );
  lines.push("");
  lines.push("export function defineEnv() {");
  lines.push(...constLines);
  lines.push("  return {");
  lines.push("    globals: {");
  emitEntries(lines, env.globals, 3);
  lines.push("    },");
  lines.push("    modules: {");
  for (const [moduleName, record] of moduleEntries) {
    const constName = constNameByRecord.get(record);
    if (constName !== undefined) {
      lines.push(`${indent(3)}${emitKey(moduleName)}: ${constName},`);
      continue;
    }
    lines.push(`${indent(3)}${emitKey(moduleName)}: {`);
    emitEntries(lines, record, 4);
    lines.push(`${indent(3)}},`);
  }
  lines.push("    },");
  lines.push("  };");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Phase 1: collect declarations
// ---------------------------------------------------------------------------

function recordFor(ctx: HarvestContext, scope: Scope): Record<string, Abs> {
  if (scope.moduleName === undefined) return ctx.globals;
  let rec = ctx.modules[scope.moduleName];
  if (!rec) {
    rec = {};
    ctx.modules[scope.moduleName] = rec;
  }
  return rec;
}

function collectStatements(ctx: HarvestContext, statements: readonly ts.Statement[], scope: Scope): void {
  for (const stmt of statements) {
    collectStatement(ctx, stmt, scope);
  }
}

function collectStatement(ctx: HarvestContext, stmt: ts.Statement, scope: Scope): void {
  if (ts.isModuleDeclaration(stmt)) {
    const body = stmt.body;
    if (!body || !ts.isModuleBlock(body)) {
      ctx.skipped++;
      return;
    }
    if (ts.isStringLiteral(stmt.name)) {
      // `declare module "node:fs" { ... }`
      ctx.declaredModules.add(stmt.name.text);
      collectStatements(ctx, body.statements, { moduleName: stmt.name.text, ns: [] });
    } else if (stmt.name.text === "global") {
      // `global { ... }` inside a module → globals
      collectStatements(ctx, body.statements, { moduleName: undefined, ns: [] });
    } else {
      // `namespace X { ... }` → types registered with qualified names,
      // runtime symbols flattened into the enclosing scope.
      collectStatements(ctx, body.statements, { moduleName: scope.moduleName, ns: [...scope.ns, stmt.name.text] });
    }
    return;
  }

  if (ts.isFunctionDeclaration(stmt)) {
    if (!stmt.name) {
      ctx.skipped++;
      return;
    }
    const name = stmt.name.text;
    const existing = ctx.pending.find((p) => p.t === "fn" && p.name === name && scopeKey(p.scope) === scopeKey(scope));
    if (existing && existing.t === "fn") {
      existing.decls.push(stmt); // overload
      return;
    }
    ctx.pending.push({ t: "fn", scope, name, decls: [stmt] });
    ctx.symbols++;
    return;
  }

  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) {
        ctx.skipped++;
        continue;
      }
      // 值位置接口暴露（@types/node 24 的 path 模块形态）：
      // `const path: path.PlatformPath`——接口成员提升为模块级符号
      // （方法签名 → fn、属性签名 → var）。@types/node 25 起这些成员是
      // 模块级 FunctionDeclaration，两代声明形态都要 harvest。
      const ifaceName = decl.type && ts.isTypeReferenceNode(decl.type)
        ? typeNameString(decl.type.typeName)
        : undefined;
      if (ifaceName && (ctx.interfaces.has(ifaceName) || ctx.qualifiedInterfaces.has(ifaceName) || true)) {
        // 推迟展开：先记 pending，materialize 时 interface 已合并 augmentation
        ctx.pending.push({
          t: "iface-expand",
          scope,
          localName: decl.name.text,
          typeRefName: ifaceName,
        });
        ctx.symbols++;
        // 同时保留 var 本体（default/namespace 消费 `_`）
        ctx.pending.push({ t: "var", scope, name: decl.name.text, typeNode: decl.type });
        ctx.symbols++;
        continue;
      }
      ctx.pending.push({ t: "var", scope, name: decl.name.text, typeNode: decl.type });
      ctx.symbols++;
    }
    return;
  }

  if (ts.isInterfaceDeclaration(stmt)) {
    registerTypeDecl(ctx, scope, stmt.name.text, stmt);
    return;
  }

  if (ts.isTypeAliasDeclaration(stmt)) {
    registerAlias(ctx, scope, stmt);
    return;
  }

  if (ts.isClassDeclaration(stmt)) {
    if (!stmt.name) {
      ctx.skipped++;
      return;
    }
    registerTypeDecl(ctx, scope, stmt.name.text, stmt);
    if (!ctx.classes.has(stmt.name.text)) ctx.classes.set(stmt.name.text, stmt);
    // A class is also a runtime value of its scope.
    ctx.pending.push({ t: "value", scope, name: stmt.name.text });
    ctx.symbols++;
    return;
  }

  if (ts.isEnumDeclaration(stmt)) {
    if (stmt.name) {
      ctx.pending.push({ t: "enum", scope, name: stmt.name.text });
      ctx.symbols++;
    }
    return;
  }

  if (ts.isImportDeclaration(stmt)) {
    // Type-only imports; names resolve through the shared flat symbol table.
    return;
  }

  if (ts.isImportEqualsDeclaration(stmt)) {
    // `import path = require("node:path")` — record for `export = path` aliasing.
    if (
      ts.isIdentifier(stmt.name) &&
      stmt.moduleReference &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteral(stmt.moduleReference.expression)
    ) {
      const key = scopeKey(scope);
      let bindings = ctx.importEquals.get(key);
      if (!bindings) {
        bindings = new Map();
        ctx.importEquals.set(key, bindings);
      }
      bindings.set(stmt.name.text, stmt.moduleReference.expression.text);
    }
    return;
  }

  if (ts.isExportDeclaration(stmt)) {
    const specifier = stmt.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)) {
      if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
        // `export * as promises from "..."` — namespace re-export, v1 skip.
        ctx.skipped++;
        return;
      }
      if (!stmt.exportClause) {
        // `export * from "node:fs"` — alias the module.
        if (scope.moduleName !== undefined) {
          ctx.moduleAliases.push([scope.moduleName, specifier.text]);
        }
        return;
      }
      // Named re-exports from another module — v1 skip.
      ctx.skipped++;
      return;
    }
    // `export { Buffer }` — re-export a local runtime value.
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const localName = (el.propertyName ?? el.name).text;
        const exportedName = el.name.text;
        const isValue =
          ctx.classes.has(localName) ||
          (!el.isTypeOnly && (ctx.interfaces.has(localName) || ctx.qualifiedInterfaces.has(localName)));
        if (isValue) {
          ctx.pending.push({ t: "value", scope, name: exportedName, lookup: localName });
          ctx.symbols++;
        } else {
          ctx.skipped++;
        }
      }
      return;
    }
    ctx.skipped++;
    return;
  }

  if (ts.isExportAssignment(stmt)) {
    // `export = x` where x is `import x = require("mod")` → module alias.
    if (stmt.expression && ts.isIdentifier(stmt.expression) && scope.moduleName !== undefined) {
      const target = ctx.importEquals.get(scopeKey(scope))?.get(stmt.expression.text);
      if (target !== undefined) {
        ctx.moduleAliases.push([scope.moduleName, target]);
        return;
      }
    }
    ctx.skipped++;
    return;
  }

  ctx.skipped++;
}

function registerTypeDecl(ctx: HarvestContext, scope: Scope, name: string, decl: NamedTypeDecl): void {
  const push = (map: Map<string, NamedTypeDecl[]>, key: string): void => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(decl)) list.push(decl);
    } else {
      map.set(key, [decl]);
    }
  };
  push(ctx.interfaces, name);
  if (ts.isClassDeclaration(decl)) return;
  const qualified = [...scope.ns, name].join(".");
  if (qualified !== name) push(ctx.qualifiedInterfaces, qualified);
}

/** TypeReference → 已登记 interface 声明列表（含 augmentation 合并） */
function interfaceDeclsOf(
  ctx: HarvestContext,
  typeNode: ts.TypeNode | string,
): ts.InterfaceDeclaration[] {
  const name = typeof typeNode === "string" ? typeNode : ts.isTypeReferenceNode(typeNode)
    ? typeNameString(typeNode.typeName)
    : undefined;
  if (!name) return [];
  // lodash：`_.LoDashStatic` 经 namespace 限定，成员却常在 `declare module "../index"`
  // 下以 simple name 登记——短名与全名都要查。
  const short = name.includes(".") ? name.split(".").pop()! : name;
  const keys = name === short ? [name] : [name, short];
  const seen = new Set<ts.InterfaceDeclaration>();
  const out: ts.InterfaceDeclaration[] = [];
  for (const key of keys) {
    for (const d of [
      ...(ctx.interfaces.get(key) ?? []),
      ...(ctx.qualifiedInterfaces.get(key) ?? []),
    ]) {
      if (ts.isInterfaceDeclaration(d) && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
  }
  return out;
}

/** TypeReference → 已登记的 interface 声明（simple 或 namespace-qualified）；class 不适用 */
function interfaceDeclOf(
  ctx: HarvestContext,
  typeNode: ts.TypeNode,
): ts.InterfaceDeclaration | undefined {
  return interfaceDeclsOf(ctx, typeNode)[0];
}

/**
 * 值位置接口暴露的成员提升（@types/node 24 path 形态、lodash LoDashStatic）：
 * 方法签名 → 模块级 fn（同名重载并入同一 pending）；属性签名 → 模块级 var。
 * **在 materialize 调用**（interface augmentation 已合并）。
 */
function expandInterfaceAsModuleMembers(
  ctx: HarvestContext,
  scope: Scope,
  ifaces: ts.InterfaceDeclaration[],
): void {
  for (const iface of ifaces) {
    for (const member of iface.members) {
      if (ts.isMethodSignature(member)) {
        const name = memberName(member);
        if (name === undefined) continue;
        const existing = ctx.pending.find(
          (p) => p.t === "fn" && p.name === name && scopeKey(p.scope) === scopeKey(scope),
        );
        if (existing && existing.t === "fn") {
          existing.decls.push(member); // overload
          continue;
        }
        ctx.pending.push({ t: "fn", scope, name, decls: [member] });
        ctx.symbols++;
        continue;
      }
      if (ts.isPropertySignature(member)) {
        const name = memberName(member);
        if (name === undefined) continue;
        if (ctx.pending.some((p) => p.t === "var" && p.name === name && scopeKey(p.scope) === scopeKey(scope))) {
          continue;
        }
        ctx.pending.push({ t: "var", scope, name, typeNode: member.type });
        ctx.symbols++;
      }
    }
  }
}

function registerAlias(ctx: HarvestContext, scope: Scope, stmt: ts.TypeAliasDeclaration): void {
  const name = stmt.name.text;
  const push = (map: Map<string, ts.TypeAliasDeclaration[]>, key: string): void => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(stmt)) list.push(stmt);
    } else {
      map.set(key, [stmt]);
    }
  };
  push(ctx.aliases, name);
  const qualified = [...scope.ns, name].join(".");
  if (qualified !== name) push(ctx.qualifiedAliases, qualified);
}

// ---------------------------------------------------------------------------
// Phase 2: materialize Abs
// ---------------------------------------------------------------------------

function materialize(ctx: HarvestContext): void {
  // 0) 先展开 iface-expand（此时 interface augmentation 已全部登记）
  const expanded: PendingSymbol[] = [];
  for (const p of ctx.pending) {
    if (p.t !== "iface-expand") {
      expanded.push(p);
      continue;
    }
    const ifaces = interfaceDeclsOf(ctx, p.typeRefName);
    if (ifaces.length === 0) {
      // 保留 var 本体即可
      continue;
    }
    const before = ctx.pending.length;
    expandInterfaceAsModuleMembers(ctx, p.scope, ifaces);
    // expandInterfaceAsModuleMembers 只 append；收集新增的 fn/var
    for (let i = before; i < ctx.pending.length; i++) {
      const n = ctx.pending[i]!;
      if (n.t === "fn" || n.t === "var") expanded.push(n);
    }
  }
  ctx.pending = expanded;

  for (const p of ctx.pending) {
    if (p.t === "iface-expand") continue;
    const rec = recordFor(ctx, p.scope);
    if (p.t === "fn") {
      if (rec[p.name] !== undefined) continue; // same name already handled (first wins)
      // 多 overload：分别算签名（保留各自 typeParams），再 join 返回位
      // ——禁止在 materialize 里二次 mapType（那时 typeParams 已清空，T→unknown）
      const sigs = p.decls.map((d) => signatureToFnSig(ctx, d));
      const value = sigs[0]!;
      const shape0 = value.shape.k === "fn" ? value.shape : undefined;
      if (shape0 && sigs.length > 1) {
        const returns: Abs[] = [];
        for (const s of sigs) {
          if (s.shape.k !== "fn") continue;
          const ret = s.shape.returnType;
          if (ret && !isPlainUnknown(ret)) returns.push(ret);
        }
        const withVars = returns.filter((r) => hasTypeVar(r));
        const pool = withVars.length > 0 ? withVars : returns;
        const mergedRet = pool.length > 0 ? absUnion(pool) : absUnknown();
        shape0.returnType = mergedRet;
        const rel = getFnImpl(value)?.relation;
        if (rel) rel.returnType = mergedRet;
      }
      rec[p.name] = value;
      continue;
    }
    if (rec[p.name] !== undefined) continue;
    switch (p.t) {
      case "var": {
        // 映射为 unknown 的声明零信息量，且会遮蔽 evaluator 内置
        // （如 URL/AbortController 的 createXxxType 构造），跳过更优。
        const mapped = p.typeNode ? mapType(ctx, p.typeNode, 0) : absUnknown();
        if (isPlainUnknown(mapped)) {
          ctx.skipped++;
          break;
        }
        rec[p.name] = mapped;
        break;
      }
      case "value": {
        // class 作为运行时值 = 构造函数：new X() 走 fnSig → instance。
        // 裸 instance 会被 new 的通用路径当作非函数 callee 退化为 unknown。
        const cls = ctx.classes.get(p.lookup ?? p.name);
        if (cls) {
          const ctor = (cls.members as readonly ts.ClassElement[]).find(ts.isConstructorDeclaration);
          const params: Abs[] = [];
          if (ctor) {
            for (const param of ctor.parameters) {
              let type = param.type ? mapType(ctx, param.type, 0) : absUnknown();
              if (param.questionToken) type = absUnion([type, absUndefLit()]);
              params.push(type);
            }
          }
          rec[p.name] = absFnSig(params, instanceFor(ctx, p.lookup ?? p.name));
        } else {
          rec[p.name] = instanceFor(ctx, p.lookup ?? p.name);
        }
        break;
      }
      case "enum":
        rec[p.name] = absUnknown();
        break;
    }
  }

  // Apply module aliases (`declare module "fs" { export * from "node:fs"; }`
  // and the `export = path` form).
  for (const [alias, target] of ctx.moduleAliases) {
    if (ctx.modules[target] && !ctx.modules[alias]) {
      ctx.modules[alias] = ctx.modules[target]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function typeNameString(name: ts.EntityName): string {
  if (ts.isIdentifier(name)) return name.text;
  return `${typeNameString(name.left)}.${name.right.text}`;
}

function memberName(node: { name?: ts.PropertyName }): string | undefined {
  const n = node.name;
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return undefined; // computed / private names
}

function instanceFor(ctx: HarvestContext, key: string): Abs {
  const cached = ctx.instanceCache.get(key);
  if (cached !== undefined) return cached;
  const decls = interfaceDeclsOf(ctx, key);
  const decl = decls[0];
  if (!decl) return absUnknown();
  if (ctx.expanding.has(key)) {
    // Recursion guard: reference by name without expanding members.
    return absBrand(decl.name?.text ?? key, {});
  }
  ctx.expanding.add(key);
  const properties: Record<string, Abs> = {};
  try {
    // 合并全部 augmentation 成员（lodash LoDashStatic 跨 common/*.d.ts）
    for (const d of decls) {
      const members = d.members as readonly (ts.TypeElement | ts.ClassElement)[];
      for (const member of members) {
        const modifiers = (member as { modifiers?: readonly { kind: ts.SyntaxKind }[] }).modifiers;
        if (modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)) continue;
        if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
          const name = memberName(member);
          if (name === undefined) continue;
          let type = member.type ? mapType(ctx, member.type, 0) : absUnknown();
          if (member.questionToken) type = absUnion([type, absUndefLit()]);
          properties[name] = type;
        } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
          const name = memberName(member);
          if (name === undefined || properties[name] !== undefined) continue; // first overload wins
          properties[name] = signatureToFnSig(ctx, member);
        } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
          const name = memberName(member);
          if (name === undefined || properties[name] !== undefined || !member.type) continue;
          properties[name] = mapType(ctx, member.type, 0);
        }
        // call / construct / index signatures are not representable — skipped.
      }
    }
  } finally {
    ctx.expanding.delete(key);
  }
  const value = absBrand(decl.name?.text ?? key, properties);
  ctx.instanceCache.set(key, value);
  return value;
}

function signatureToFnSig(ctx: HarvestContext, sig: ts.SignatureDeclaration): Abs {
  const savedTp = ctx.typeParams;
  ctx.typeParams = new Set(savedTp);
  for (const tp of sig.typeParameters ?? []) {
    ctx.typeParams.add(tp.name.text);
  }
  try {
    const paramTypes = sig.parameters.map((param) => {
      let type: Abs;
      if (param.dotDotDotToken) {
        const inner = param.type && ts.isArrayTypeNode(param.type) ? param.type.elementType : param.type;
        type = inner ? absArr(mapType(ctx, inner, 0)) : absUnknown();
      } else {
        type = param.type ? mapType(ctx, param.type, 0) : absUnknown();
      }
      if (param.questionToken && !param.dotDotDotToken) type = absUnion([type, absUndefLit()]);
      return type;
    });
    const returnType = sig.type ? mapType(ctx, sig.type, 0) : absUnknown();
    return absFnSig(paramTypes, returnType);
  } finally {
    ctx.typeParams = savedTp;
  }
}

function mapTypeMembers(
  ctx: HarvestContext,
  members: readonly ts.TypeElement[],
  depth: number,
): Record<string, Abs> {
  const properties: Record<string, Abs> = {};
  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      const name = memberName(member);
      if (name === undefined) continue;
      let type = member.type ? mapType(ctx, member.type, depth) : absUnknown();
      if (member.questionToken) type = absUnion([type, absUndefLit()]);
      properties[name] = type;
    } else if (ts.isMethodSignature(member)) {
      const name = memberName(member);
      if (name === undefined || properties[name] !== undefined) continue; // first overload wins
      properties[name] = signatureToFnSig(ctx, member);
    }
    // index / call / construct signatures skipped
  }
  return properties;
}

function mapTypeRef(ctx: HarvestContext, node: ts.TypeReferenceNode, depth: number): Abs {
  const name = typeNameString(node.typeName);
  const args = node.typeArguments ?? [];
  // 泛型形参 T → var Abs（供 relationFn α 替换）
  if (ctx.typeParams.has(name) && args.length === 0) {
    return typeVarAbs(name);
  }
  if ((name === "Array" || name === "ReadonlyArray") && args.length >= 1) {
    return absArr(mapType(ctx, args[0], depth));
  }
  // lodash List/ArrayLike/Collection/Many<T> 等未知容器：保 type arg 进 arr，供合一
  if (
    (name === "List" || name === "ArrayLike" || name === "Collection" || name === "Many" ||
      name === "NumericDictionary" || name === "Dictionary") &&
    args.length >= 1
  ) {
    return absArr(mapType(ctx, args[0], depth));
  }
  if (name === "Promise" && args.length >= 1) {
    return absPromise(mapType(ctx, args[0], depth));
  }
  if (name === "Record") {
    // Index-signature objects are approximated as an open object type.
    return absObj({});
  }
  if (ctx.interfaces.has(name) || ctx.qualifiedInterfaces.has(name)) {
    return instanceFor(ctx, name);
  }
  const aliases = ctx.aliases.get(name) ?? ctx.qualifiedAliases.get(name) ?? [];
  const alias = aliases[0];
  if (alias) return mapType(ctx, alias.type, depth + 1);
  return absUnknown();
}

function mapType(ctx: HarvestContext, node: ts.TypeNode | undefined, depth: number): Abs {
  if (!node || depth > MAX_ALIAS_DEPTH) return absUnknown();

  if (ts.isParenthesizedTypeNode(node)) return mapType(ctx, node.type, depth);
  if (ts.isTypeReferenceNode(node)) return mapTypeRef(ctx, node, depth);

  if (ts.isArrayTypeNode(node)) return absArr(mapType(ctx, node.elementType, depth));
  if (ts.isTupleTypeNode(node)) {
    for (const element of node.elements) {
      const inner = ts.isNamedTupleMember(element) ? element.type : element;
      return absArr(mapType(ctx, inner, depth)); // approximate by the first element
    }
    return absUnknown();
  }

  if (ts.isUnionTypeNode(node)) {
    return absUnion(node.types.map((t) => mapType(ctx, t, depth)));
  }

  if (ts.isIntersectionTypeNode(node)) {
    const members = node.types.map((t) => mapType(ctx, t, depth));
    if (members.length > 0 && members.every((m) => m.shape.k === "obj")) {
      const properties: Record<string, Abs> = {};
      for (const member of members) {
        if (member.shape.k !== "obj") continue;
        for (const [k, slot] of Object.entries(member.shape.slots)) {
          properties[k] = slot.value;
        }
      }
      return absObj(properties);
    }
    return members[0] ?? absUnknown();
  }

  if (ts.isLiteralTypeNode(node)) {
    const lit = node.literal;
    if (ts.isStringLiteral(lit)) return absLit(lit.text);
    if (ts.isNumericLiteral(lit)) return absLit(Number(lit.text));
    if (lit.kind === ts.SyntaxKind.TrueKeyword) return absLit(true);
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return absLit(false);
    if (
      ts.isPrefixUnaryExpression(lit) &&
      lit.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(lit.operand)
    ) {
      return absLit(-Number(lit.operand.text));
    }
    return absUnknown();
  }

  if (ts.isFunctionTypeNode(node)) return signatureToFnSig(ctx, node);

  if (ts.isTypeLiteralNode(node)) {
    // 带构造签名的对象字面量类型（如 @types/node 的 var URL: { new(...): URL; ... }）
    // 是构造函数形状：new X() 需要 function callee + fnSig 返回实例。
    const ctor = node.members.find(ts.isConstructSignatureDeclaration);
    if (ctor) {
      const params: Abs[] = [];
      for (const param of ctor.parameters) {
        let type = param.type ? mapType(ctx, param.type, depth) : absUnknown();
        if (param.questionToken) type = absUnion([type, absUndefLit()]);
        params.push(type);
      }
      return absFnSig(params, ctor.type ? mapType(ctx, ctor.type, depth) : absUnknown());
    }
    return absObj(mapTypeMembers(ctx, node.members, depth));
  }

  if (ts.isTypeOperatorNode(node)) {
    return node.operator === ts.SyntaxKind.ReadonlyKeyword ? mapType(ctx, node.type, depth) : absUnknown();
  }

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return absPrim("string");
    case ts.SyntaxKind.NumberKeyword:
      return absPrim("number");
    case ts.SyntaxKind.BooleanKeyword:
      return absPrim("boolean");
    case ts.SyntaxKind.BigIntKeyword:
      return absPrim("bigint");
    case ts.SyntaxKind.SymbolKeyword:
      return absPrim("symbol");
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.ObjectKeyword:
      return absUnknown();
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return absUndefLit();
    case ts.SyntaxKind.NeverKeyword:
      return absNever();
    case ts.SyntaxKind.NullKeyword:
      return absNullLit();
    default:
      // typeof X, keyof, conditional / mapped / indexed / template-literal /
      // import() types and everything else — conservative degradation.
      return absUnknown();
  }
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function indent(level: number): string {
  return "  ".repeat(level);
}

function emitKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function emitEntries(lines: string[], record: Record<string, Abs>, level: number): void {
  for (const [key, value] of Object.entries(record)) {
    lines.push(`${indent(level)}${emitKey(key)}: ${emitAbs(value, new Set())},`);
  }
}

/** Abs → 构造源码（harvest 产物 Abs 原生） */
function emitAbs(a: Abs, expanding: Set<string>): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "absNever";
    case "unknown":
      if (a.term?.op === "lit") {
        const v = a.term.value;
        if (v === null) return `makeAbs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact")`;
        if (v === undefined) return `makeAbs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact")`;
        if (typeof v === "number") return `numLit(${JSON.stringify(v)})`;
        if (typeof v === "boolean") return `boolLit(${v})`;
        if (typeof v === "string") return `strLit(${JSON.stringify(v)})`;
      }
      return "absUnknown";
    case "any":
      return "absUnknown";
    case "prim": {
      if (a.term?.op === "lit") {
        const v = a.term.value;
        if (typeof v === "number") return `numLit(${JSON.stringify(v)})`;
        if (typeof v === "boolean") return `boolLit(${v})`;
        if (typeof v === "string") return `strLit(${JSON.stringify(v)})`;
      }
      if (s.type === "number") return "num()";
      if (s.type === "string") return "str()";
      if (s.type === "boolean") return "bool()";
      return "absUnknown";
    }
    case "arr":
      return `makeAbs({ k: "arr", element: ${emitAbs(s.element, expanding)} }, undefined, undefined, "exact")`;
    case "tuple":
      return `makeAbs({ k: "tuple", elements: [${s.elements.map((e) => emitAbs(e, expanding)).join(", ")}] }, undefined, undefined, "exact")`;
    case "eff":
      return `makeAbs({ k: "eff", eff: ${JSON.stringify(s.eff)}, inner: ${emitAbs(s.inner, expanding)} }, undefined, undefined, "exact")`;
    case "obj": {
      const entries = Object.entries(s.slots).map(
        ([key, slot]) => `${emitKey(key)}: { value: ${emitAbs(slot.value, expanding)} }`,
      );
      return `objOf({ ${entries.join(", ")} })`;
    }
    case "brand": {
      if (expanding.has(s.name)) {
        return `makeAbs({ k: "brand", name: ${JSON.stringify(s.name)}, shape: absUnknown }, undefined, undefined, "path")`;
      }
      expanding.add(s.name);
      try {
        return `makeAbs({ k: "brand", name: ${JSON.stringify(s.name)}, shape: ${emitAbs(s.shape, expanding)} }, undefined, undefined, "path")`;
      } finally {
        expanding.delete(s.name);
      }
    }
    case "sum": {
      if (s.members.length === 0) return "absNever";
      if (s.members.length === 1) return emitAbs(s.members[0]!, expanding);
      return `makeAbs({ k: "sum", members: [${s.members.map((m) => emitAbs(m, expanding)).join(", ")}] }, undefined, undefined, "exact")`;
    }
    case "fn": {
      const pts = s.paramTypes ?? [];
      const params = pts.map((p) => emitAbs(p, expanding)).join(", ");
      const ret = s.returnType ? emitAbs(s.returnType, expanding) : "absUnknown";
      return `relationFn([${params}], ${ret}, { conf: "exact" })`;
    }
    default:
      return "absUnknown";
  }
}

export {
  dtsToContractDraft,
  dtsPathToContractDraft,
  formatDtsContractDraft,
  type DtsContractDraft,
  type DtsExportDraft,
} from "./dts-contract-draft.ts";
