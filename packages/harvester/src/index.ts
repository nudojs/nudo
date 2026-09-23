import { readFileSync, statSync } from "node:fs";
import ts from "typescript";
import {
  type Abs,
  type Slot,
  abs as makeAbs,
  lit as termLit,
  numLit,
  strLit,
  boolLit,
  objOf,
  joinAbs,
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
  | { t: "enum"; scope: Scope; name: string };

interface HarvestContext {
  globals: Record<string, Abs>;
  modules: Record<string, Record<string, Abs>>;
  /** simple name → interface/class declaration (first wins) */
  interfaces: Map<string, NamedTypeDecl>;
  /** dotted name ("NodeJS.Process") → declaration (first wins) */
  qualifiedInterfaces: Map<string, NamedTypeDecl>;
  /** simple name → type alias declaration (first wins) */
  aliases: Map<string, ts.TypeAliasDeclaration>;
  /** dotted name → type alias declaration (first wins) */
  qualifiedAliases: Map<string, ts.TypeAliasDeclaration>;
  /** simple name → class declaration (runtime values, for `export { X }` re-exports) */
  classes: Map<string, ts.ClassDeclaration>;
  instanceCache: Map<string, Abs>;
  expanding: Set<string>;
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
  return absExact({
    k: "fn",
    params: paramTypes.map((_, i) => `_arg${i}`),
    paramTypes,
    returnType,
  });
}

/** multi-member union via binary join (drops never, absorbs lit into prim) */
function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absNever();
  return members.reduce((acc, m) => joinAbs(acc, m));
}

function isPlainUnknown(a: Abs): boolean {
  return a.shape.k === "unknown" && !(a.term?.op === "lit");
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
      const iface = decl.type ? interfaceDeclOf(ctx, decl.type) : undefined;
      if (iface) {
        expandInterfaceAsModuleMembers(ctx, scope, iface);
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
  if (!ctx.interfaces.has(name)) ctx.interfaces.set(name, decl);
  if (ts.isClassDeclaration(decl)) return; // classes register only their simple name
  const qualified = [...scope.ns, name].join(".");
  if (qualified !== name && !ctx.qualifiedInterfaces.has(qualified)) {
    ctx.qualifiedInterfaces.set(qualified, decl);
  }
}

/** TypeReference → 已登记的 interface 声明（simple 或 namespace-qualified）；class 不适用 */
function interfaceDeclOf(
  ctx: HarvestContext,
  typeNode: ts.TypeNode,
): ts.InterfaceDeclaration | undefined {
  if (!ts.isTypeReferenceNode(typeNode)) return undefined;
  const name = typeNameString(typeNode.typeName);
  const d = ctx.interfaces.get(name) ?? ctx.qualifiedInterfaces.get(name);
  return d && ts.isInterfaceDeclaration(d) ? d : undefined;
}

/**
 * 值位置接口暴露的成员提升（@types/node 24 path 形态）：
 * 方法签名 → 模块级 fn（同名重载并入同一 pending）；属性签名 → 模块级 var。
 * 直接成员一层，不递归（嵌套接口经 mapTypeRef 映射为实例形状）。
 */
function expandInterfaceAsModuleMembers(
  ctx: HarvestContext,
  scope: Scope,
  iface: ts.InterfaceDeclaration,
): void {
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
      ctx.pending.push({ t: "var", scope, name, typeNode: member.type });
      ctx.symbols++;
    }
  }
}

function registerAlias(ctx: HarvestContext, scope: Scope, stmt: ts.TypeAliasDeclaration): void {
  const name = stmt.name.text;
  if (!ctx.aliases.has(name)) ctx.aliases.set(name, stmt);
  const qualified = [...scope.ns, name].join(".");
  if (qualified !== name && !ctx.qualifiedAliases.has(qualified)) {
    ctx.qualifiedAliases.set(qualified, stmt);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: materialize Abs
// ---------------------------------------------------------------------------

function materialize(ctx: HarvestContext): void {
  for (const p of ctx.pending) {
    const rec = recordFor(ctx, p.scope);
    if (p.t === "fn") {
      if (rec[p.name] !== undefined) continue; // same name already handled (first wins)
      const value = signatureToFnSig(ctx, p.decls[0]!); // first overload's parameter list
      const sig = value.shape.k === "fn" ? value.shape : undefined;
      if (sig) {
        // Merge return types across overloads; drop unknown members when a
        // known one exists so unresolved references don't erase information.
        const returns: Abs[] = [];
        for (const decl of p.decls) {
          if (!decl.type) continue;
          const ret = mapType(ctx, decl.type, 0);
          if (!isPlainUnknown(ret)) returns.push(ret);
        }
        sig.returnType = returns.length > 0 ? absUnion(returns) : absUnknown();
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
  const decl = ctx.interfaces.get(key) ?? ctx.qualifiedInterfaces.get(key);
  if (!decl) return absUnknown();
  if (ctx.expanding.has(key)) {
    // Recursion guard: reference by name without expanding members.
    return absBrand(decl.name?.text ?? key, {});
  }
  ctx.expanding.add(key);
  const properties: Record<string, Abs> = {};
  try {
    const members = decl.members as readonly (ts.TypeElement | ts.ClassElement)[];
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
  } finally {
    ctx.expanding.delete(key);
  }
  const value = absBrand(decl.name?.text ?? key, properties);
  ctx.instanceCache.set(key, value);
  return value;
}

function signatureToFnSig(ctx: HarvestContext, sig: ts.SignatureDeclaration): Abs {
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
  if ((name === "Array" || name === "ReadonlyArray") && args.length >= 1) {
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
  const alias = ctx.aliases.get(name) ?? ctx.qualifiedAliases.get(name);
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
