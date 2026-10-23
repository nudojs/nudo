import { readFileSync, statSync } from "node:fs";
import ts from "typescript";
import {
  type Abs,
  type Slot,
  abs as makeAbs,
  lit as termLit,
  v as termVar,
  objOf,
  joinAbs,
  relationFn,
  getFnImpl,
  substAbs,
  formatShape,
  absShapeKey,
  termToString,
} from "@nudojs/core";
import { absLit } from "@nudojs/core/internal";

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
  | { t: "iface-expand"; scope: Scope; localName: string; typeRefName: string }
  /**
   * 命名空间对象（Bug 793）：命名空间的**运行时成员**留在 `NS.member` 面，
   * **不摊平**进外层记录（顶层命名空间摊平 ⇒ 凭空造出全局 + 抑制 ReferenceError）。
   * `rec` = 该命名空间自有的运行时记录；`scope` = 外层作用域（对象挂哪）。
   */
  | { t: "ns"; scope: Scope; name: string; rec: Record<string, Abs> };

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
  /** 未决条件类型元数据（signatureToFnSig 挂到 relation） */
  pendingCond?: CondMeta;
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
  /**
   * 命名空间自有的运行时记录（Bug 793）：命名空间成员落这里，
   * **不摊平**进外层记录（globals / 模块记录）。
   */
  nsRec?: Record<string, Abs>;
}

const MAX_ALIAS_DEPTH = 8;

function scopeKey(scope: Scope): string {
  const base = scope.moduleName ?? "\0global";
  // 命名空间链参与作用域键（Bug 793）：不同命名空间的同名成员**不是**同一个
  // 作用域（否则两个命名空间里的同名函数会被当成 overload 合并）。
  // 只对「命名空间对象」路径生效（成员有自己的记录），模块作用域的摊平口径不变。
  return scope.nsRec && scope.ns.length > 0 ? `${base}\0ns:${scope.ns.join(".")}` : base;
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

function absArr(element: Abs): Abs {
  return absExact({ k: "arr", element });
}

function absTuple(elements: Abs[]): Abs {
  return absExact({ k: "tuple", elements });
}

function absPromise(inner: Abs): Abs {
  return absExact({ k: "eff", eff: "promise", inner });
}

/** Map/ReadonlyMap/WeakMap<K,V> → brand（__key/__value 供 α 合一） */
function absMapType(name: string, key: Abs, value: Abs): Abs {
  // 不把 get/set 嵌进 brand：lodash 规模下 relationFn fingerprint 会 OOM。
  // 成员语义走 core collections / dispatchMethod；这里只保类型参。
  return absExact({
    k: "brand",
    name,
    shape: absObj({
      __key: key,
      __value: value,
    }),
  });
}

/** Set/ReadonlySet<T> → brand（__elem 供 α 合一） */
function absSetType(name: string, elem: Abs): Abs {
  return absExact({
    k: "brand",
    name,
    shape: absObj({
      __elem: elem,
    }),
  });
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

function absFnSig(
  paramTypes: Abs[],
  returnType: Abs,
  extra?: {
    inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
    condFallback?: Abs;
  },
): Abs {
  // relationFn 双写 shape + impl.relation → 调用点 instantiateReturn 做 α 替换
  return relationFn(paramTypes, returnType, {
    params: paramTypes.map((_, i) => `_arg${i}`),
    conf: "exact",
    ...(extra ?? {}),
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
    // 族 27 Bug 811：泛型 α 的 var term 要落盘 ⇒ 生成代码需要 `termVar`。
    'import { num, str, bool, never as absNever, unknown as absUnknown, numLit, strLit, boolLit, objOf, relationFn, abs as makeAbs, v as termVar } from "@nudojs/core";',
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

/**
 * 无原型字典（own-property 纪律）。
 *
 * 普通 `{}` 的原型链上挂着 `toString` / `valueOf` / `constructor` /
 * `hasOwnProperty` / `__proto__` 等成员，于是：
 *   - 裸读 `rec[name] !== undefined` 会命中原型成员 ⇒ 撞名的导出被当成
 *     「已处理」而**整条静默丢失**（Bug 828）；
 *   - 裸写 `rec["__proto__"] = v` 走 `[[SetPrototypeOf]]` ⇒ 写穿到原型链
 *     （`declare module "__proto__"` ⇒ **进程级原型污染**，Bug 836）。
 *
 * `Object.create(null)` 没有原型 ⇒ 只有自有键可见，`__proto__` 只是普通数据键。
 */
function nullDict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** 普通对象 → 无原型字典（保留自有可枚举键；本身已无原型则原样返回） */
function toNullDict<T>(src: Record<string, T>): Record<string, T> {
  if (Object.getPrototypeOf(src) === null) return src;
  const out = nullDict<T>();
  // Object.keys 只列自有可枚举键 ⇒ 不会把原型链上的成员搬进来
  for (const key of Object.keys(src)) out[key] = src[key];
  return out;
}

function recordFor(ctx: HarvestContext, scope: Scope): Record<string, Abs> {
  // 表本身必须无原型：否则模块名撞原型成员时，记录会读穿到 Object.prototype
  ctx.globals = toNullDict(ctx.globals);
  ctx.modules = toNullDict(ctx.modules);
  // Bug 793：命名空间自有的记录 —— 命名空间成员落这里，**不摊平**进外层记录
  if (scope.nsRec) return scope.nsRec;
  if (scope.moduleName === undefined) return ctx.globals;
  // own-property 判定：`ctx.modules["__proto__"]` / `["constructor"]` 裸读会
  // 命中原型链上的东西（`Object.prototype` 本身 / `Object` 构造函数），
  // truthy ⇒ 误判「已有记录」⇒ 导出被写进原型链（Bug 836）。
  let rec = Object.hasOwn(ctx.modules, scope.moduleName)
    ? ctx.modules[scope.moduleName]
    : undefined;
  if (!rec) {
    rec = nullDict<Abs>();
    // 无原型表上 `__proto__` 只是普通数据键 ⇒ 不会触发 [[SetPrototypeOf]]
    ctx.modules[scope.moduleName] = rec;
  }
  return rec;
}

function collectStatements(ctx: HarvestContext, statements: readonly ts.Statement[], scope: Scope): void {
  for (const stmt of statements) {
    collectStatement(ctx, stmt, scope);
  }
}

/**
 * `export default …` judgment: the export name is `default`, not the local name.
 * `export = X` is an ExportAssignment (with `isExportEquals`) and never carries this modifier.
 */
function isDefaultExportDecl(node: ts.Node): boolean {
  const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (flags & ts.ModifierFlags.Default) !== 0;
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
      // `namespace X { ... }` → types registered with qualified names.
      //
      // Bug 793：**全局作用域**的命名空间，其运行时成员留在命名空间的名字
      // 空间里（`Foo.bar`），**不摊平**进 globals。旧口径把成员摊平 ⇒ 顶层
      // `declare namespace Foo { function bar() {} }` 凭空造出全局 `bar`
      // （运行时并不存在裸 `bar`）⇒ 并**抑制**了对应的 ReferenceError 诊断。
      //
      // 模块作用域（`declare module "x" { namespace Y { … } }`）保持既有口径
      // （成员摊平进模块记录）：`export = ns` 的模块（@types/node 的 path /
      // fs）正是这个形态，模块的导出面 = 命名空间的成员面。
      const nsName = stmt.name.text;
      if (scope.moduleName !== undefined) {
        collectStatements(ctx, body.statements, { moduleName: scope.moduleName, ns: [...scope.ns, nsName] });
        return;
      }
      const nsRec = nullDict<Abs>();
      collectStatements(ctx, body.statements, {
        moduleName: undefined,
        ns: [...scope.ns, nsName],
        nsRec,
      });
      // 命名空间对象：成员先物化完再挂（pending 顺序保证，见 materialize）
      ctx.pending.push({ t: "ns", scope, name: nsName, rec: nsRec });
      ctx.symbols++;
    }
    return;
  }

  if (ts.isFunctionDeclaration(stmt)) {
    if (!stmt.name) {
      ctx.skipped++;
      return;
    }
    const name = stmt.name.text;
    // `export default function foo()` —— the export name is `default`; the local name `foo` is
    // **not** a named export (Bug 814: the default export's local name was treated as a named
    // export ⇒ false green — `import { foo } from "pkg"` resolved successfully, while TS reports TS2614).
    const exportName = isDefaultExportDecl(stmt) ? "default" : name;
    const existing = ctx.pending.find((p) => p.t === "fn" && p.name === exportName && scopeKey(p.scope) === scopeKey(scope));
    if (existing && existing.t === "fn") {
      existing.decls.push(stmt); // overload
      return;
    }
    ctx.pending.push({ t: "fn", scope, name: exportName, decls: [stmt] });
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
    // `export default class Foo {}` —— the export name is `default`; the local name `Foo` is
    // **not** a named export (Bug 814).
    if (isDefaultExportDecl(stmt)) {
      // 导出条目本身在物化阶段计数（这里不再重复计数）
      ctx.pending.push({ t: "value", scope, name: "default", lookup: stmt.name.text });
    } else {
      ctx.pending.push({ t: "value", scope, name: stmt.name.text });
      ctx.symbols++;
    }
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
      // `export type { X }` —— the whole declaration is type-position (`stmt.isTypeOnly`);
      // `export { type X }` —— the single specifier is type-position (`el.isTypeOnly`).
      // Both are type exports ⇒ not runtime values.
      const clauseTypeOnly = stmt.isTypeOnly === true;
      for (const el of stmt.exportClause.elements) {
        const localName = (el.propertyName ?? el.name).text;
        const exportedName = el.name.text;
        // Whether it is a value is decided in the **materialize** phase (phase 2), when the symbol
        // table is complete: deciding it here makes the export table depend on the .d.ts traversal
        // order (the same declaration set, a different file order ⇒ one export missing) (Bug 820).
        if (clauseTypeOnly || el.isTypeOnly) {
          ctx.skipped++;
          continue;
        }
        ctx.pending.push({ t: "value", scope, name: exportedName, lookup: localName });
      }
      return;
    }
    ctx.skipped++;
    return;
  }

  if (ts.isExportAssignment(stmt)) {
    // `export = x` where x is `import x = require("mod")` → module alias.
    if (
      stmt.isExportEquals &&
      stmt.expression &&
      ts.isIdentifier(stmt.expression) &&
      scope.moduleName !== undefined
    ) {
      const target = ctx.importEquals.get(scopeKey(scope))?.get(stmt.expression.text);
      if (target !== undefined) {
        ctx.moduleAliases.push([scope.moduleName, target]);
        return;
      }
    }
    // `export default X` / `export = X` (X is a local declaration) → the `default` export
    // (resolved in the materialize phase, when the symbol table is complete).
    // `export = X` is the CJS form: the module exports the entity itself (Bug 818 / 824).
    if (stmt.expression && ts.isIdentifier(stmt.expression)) {
      ctx.pending.push({ t: "value", scope, name: "default", lookup: stmt.expression.text });
      return;
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
  // Bug 796：class 与 interface 共用一张表 —— 但**限定名**也要登记
  // （命名空间里的 class：`NodeJS.Process` ⇒ `Process` 的实例面可解析）。
  // 此前 class 在此提前 return ⇒ 限定路径同样落空。
  const qualified = [...scope.ns, name].join(".");
  if (qualified !== name) push(ctx.qualifiedInterfaces, qualified);
}

/**
 * 声明所在的**命名空间链**（`declare namespace A { interface Opts {} }` → ["A"]）。
 *
 * `declare global { … }` 的 "global" **不是**命名空间：TS 侧它的内容是全局作用域的
 * ambient 声明（不是 `global.X`）。
 */
function namespaceChainOf(decl: ts.Node): string[] {
  const chain: string[] = [];
  let node: ts.Node | undefined = decl.parent;
  while (node) {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.name.text !== "global") {
      chain.unshift(node.name.text);
    }
    node = node.parent;
  }
  return chain;
}

/**
 * 声明是否位于 **ambient 模块块**内（`declare module "x" { … }`）——模块增强的形态。
 *
 * lodash 的 `declare module "idx" { interface LoDashStatic { … } }` 就是这一形态：
 * 它以**短名**登记，却与 `_.LoDashStatic`（命名空间限定名）指同一个实体。
 */
function inAmbientModuleBlock(decl: ts.Node): boolean {
  let node: ts.Node | undefined = decl.parent;
  while (node) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/**
 * heritage 子句里的基类型名（`Base` / `NS.Base`）。
 *
 * `ts.ExpressionWithTypeArguments.expression` 是 `LeftHandSideExpression`
 * （不是 `ts.EntityName`）⇒ 命名空间限定的基类型（`NS.Base`）是 PropertyAccess
 * 表达式 ⇒ 这里自己把点分名拼出来。
 */
function heritageBaseName(expr: ts.ExpressionWithTypeArguments): string | undefined {
  const text = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const left = text(node.expression);
      if (left === undefined) return undefined;
      return `${left}.${node.name.text}`;
    }
    return undefined;
  };
  return text(expr.expression);
}

/**
 * 计算成员名的**可判定**形态（Bug 832）。
 *
 * `[Symbol.iterator]()` 是**迭代协议**的标准入口（ES 规范的一等公民）——丢弃它
 * 等于丢掉整个迭代协议 ⇒ `for…of` 被判「对不可迭代值迭代」⇒ L2 假红（而
 * `tsc --strict` 对同一份代码 exit 0）。
 *
 * 引擎把 symbol 键投影成 `@@name`（core 口径：`@@iterator` / `@@asyncIterator`）
 * ⇒ 这里对齐。**只认常量形式**：`Symbol.iterator` / `Symbol.asyncIterator` /
 * 字符串字面量；其余（`[key]`、`[foo()]`）不可静态判定 ⇒ undefined（调用方跳过）。
 */
function computedMemberName(name: ts.PropertyName | undefined): string | undefined {
  if (!name || !ts.isComputedPropertyName(name)) return undefined;
  const expr = name.expression;
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "Symbol"
  ) {
    if (expr.name.text === "iterator") return "@@iterator";
    if (expr.name.text === "asyncIterator") return "@@asyncIterator";
    return undefined;
  }
  if (ts.isStringLiteral(expr)) return expr.text;
  return undefined;
}

/**
 * TypeReference → 已登记的 interface / class 声明列表（含 augmentation 合并）。
 *
 * Bug 796：此前只收 `isInterfaceDeclaration` ⇒ `declare class` 的**实例成员**
 * 整体丢失（`instanceFor` 拿不到任何成员 ⇒ 展开成空 obj），`const p: Point`
 * 这条绑定随之退成 unknown 再被丢弃。class 的成员收集器（属性/方法/访问器）
 * 本来就写好了，只是被这道过滤挡在门外 ⇒ 这里放行 class。
 *
 * Bug 792：**限定名**解析必须带命名空间身份。短名桶（`ctx.interfaces`）不带命名空间
 * 身份 ⇒ 此前 `A.Opts` 与 `B.Opts` 被无条件并集 ⇒ `A.Opts` 继承了 `B.Opts` 的成员。
 * 现在：限定名只精确命中自己的限定桶，短名回退**只**认「ambient 模块块里的模块增强
 * 声明」（lodash 形态）——命名空间里的同名接口不再互相并入。
 *
 * Bug 809：`extends` 子句的**基接口**成员并入实例模型（递归）。此前只搬接口**自身**
 * 声明的成员 ⇒ `interface Derived extends Base` 的 `derived.b` 读不到 ⇒ 折 exact
 * `undefined` ⇒ 后续 `.length` 被判「确定抛 TypeError」（L2 假红）。
 */
function interfaceDeclsOf(
  ctx: HarvestContext,
  typeNode: ts.TypeNode | string,
  /** 继承链上的名字（环保护）：`A extends B` / `B extends A` */
  chain?: Set<string>,
): NamedTypeDecl[] {
  const name = typeof typeNode === "string" ? typeNode : ts.isTypeReferenceNode(typeNode)
    ? typeNameString(typeNode.typeName)
    : undefined;
  if (!name) return [];
  const visited = chain ?? new Set<string>();
  if (visited.has(name)) return []; // 继承环（TS 非法，但 .d.ts 可能手写）
  const nextChain = new Set(visited);
  nextChain.add(name);
  const short = name.includes(".") ? name.split(".").pop()! : name;
  const qualified = name !== short;
  const seen = new Set<NamedTypeDecl>();
  const out: NamedTypeDecl[] = [];
  const add = (d: NamedTypeDecl): void => {
    if (seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };
  // 精确名（限定名 → 限定桶；短名 → 短名桶）
  for (const d of ctx.interfaces.get(name) ?? []) add(d);
  for (const d of ctx.qualifiedInterfaces.get(name) ?? []) add(d);
  if (qualified) {
    // 短名回退：**只**认 ambient 模块块里的模块增强声明（lodash 形态）。
    // 命名空间里的同名接口（A.Opts / B.Opts）**不得**互相并入（Bug 792）。
    for (const d of ctx.interfaces.get(short) ?? []) {
      if (namespaceChainOf(d).length === 0 && inAmbientModuleBlock(d)) add(d);
    }
  }
  // Bug 809：`extends` 的基声明成员并入（递归；基声明排在自身之后）
  for (const d of [...out]) {
    for (const clause of d.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const expr of clause.types) {
        const baseName = heritageBaseName(expr);
        if (!baseName) continue;
        for (const b of interfaceDeclsOf(ctx, baseName, nextChain)) add(b);
      }
    }
  }
  return out;
}

/** TypeReference → 已登记的 interface / class 声明（simple 或 namespace-qualified） */
function interfaceDeclOf(
  ctx: HarvestContext,
  typeNode: ts.TypeNode,
): NamedTypeDecl | undefined {
  return interfaceDeclsOf(ctx, typeNode)[0];
}

/**
 * ctx → **真实声明**的名字集合（scope 限定）。
 *
 * 「接口成员提升」不得抢真实声明的名字（Bug 831）：提升成员排在真实声明之前，
 * 物化时「同名先到先得」⇒ 真实导出整条被丢弃（`export declare function x(): string`
 * 被接口成员 `x: number` 顶掉 ⇒ 真实调用被判「对 number 调用」⇒ L2 假红）。
 *
 * 快照必须在**任何提升发生之前**采集（提升会往 `ctx.pending` 里追加条目）
 * ⇒ 惰性取一次并按 ctx 缓存。
 */
const realDeclNameCache = new WeakMap<HarvestContext, Set<string>>();

function realDeclNames(ctx: HarvestContext): Set<string> {
  const cached = realDeclNameCache.get(ctx);
  if (cached) return cached;
  const set = new Set<string>();
  for (const p of ctx.pending) {
    if (p.t === "iface-expand") continue; // 提升指令本身不是声明
    set.add(`${scopeKey(p.scope)}::${p.name}`);
  }
  realDeclNameCache.set(ctx, set);
  return set;
}

/** scope + 名字 → 真实声明集合的键 */
function declNameKey(scope: Scope, name: string): string {
  return `${scopeKey(scope)}::${name}`;
}

/** 可选属性的提升类型：`T | undefined`（与 brand 面同口径，Bug 808） */
function optionalPropTypeNode(member: ts.PropertySignature): ts.TypeNode | undefined {
  if (!member.type) return undefined;
  if (!member.questionToken) return member.type;
  return ts.factory.createUnionTypeNode([
    member.type,
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
  ]);
}

/** 可选方法的提升类型：`(() => T) | undefined`（与 brand 面同口径，Bug 977） */
function optionalMethodTypeNode(member: ts.MethodSignature): ts.TypeNode {
  const fn = ts.factory.createFunctionTypeNode(
    member.typeParameters,
    member.parameters,
    // 无返回类型标注 ⇒ `any`（`signatureToFnSig` 对缺省返回位的口径是 unknown）
    member.type ?? ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
  );
  return ts.factory.createUnionTypeNode([
    fn,
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
  ]);
}

/**
 * 值位置接口暴露的成员提升（@types/node 24 path 形态、lodash LoDashStatic）：
 * 方法签名 → 模块级 fn（同名重载并入同一 pending）；属性签名 → 模块级 var。
 * **在 materialize 调用**（interface augmentation 已合并）。
 *
 * Bug 831：提升出来的成员**不是模块导出**（TS：接口成员只在类型内部可见），
 * 且**不得**抢真实导出的名字 ⇒ 真实声明优先，提升只补「没有真实声明」的名字。
 *
 * Bug 807：同一成员在 **brand 面**与**提升面**必须是同一个类型。泛型接口的成员
 * 类型依赖类型实参，提升路径看不到实参 ⇒ 提升出来的是未绑定 α（与 brand 面的
 * 实参代入结果不同）⇒ 泛型接口的成员**不提升**（它们留在 brand 面，那里才有实参）。
 */
function expandInterfaceAsModuleMembers(
  ctx: HarvestContext,
  scope: Scope,
  ifaces: readonly NamedTypeDecl[],
): void {
  const real = realDeclNames(ctx);
  // 同名方法按 overload 集合并（brand 面的 `methodSigs` 同口径：一个名字一个槽）
  const methods = new Map<string, ts.MethodSignature[]>();
  // 同名属性：后者覆盖前者（brand 面的 `properties[name] = type` 同口径）
  const props = new Map<string, ts.PropertySignature>();
  for (const iface of ifaces) {
    // Bug 807：泛型接口的成员不提升（提升路径没有类型实参 ⇒ 与 brand 面不一致）
    if ((iface.typeParameters ?? []).length > 0) continue;
    for (const member of iface.members) {
      if (ts.isMethodSignature(member)) {
        const name = memberName(member);
        if (name === undefined) continue;
        const list = methods.get(name);
        if (list) list.push(member);
        else methods.set(name, [member]);
        continue;
      }
      if (ts.isPropertySignature(member)) {
        const name = memberName(member);
        if (name === undefined) continue;
        props.set(name, member);
      }
    }
  }
  for (const [name, decls] of methods) {
    // 属性位优先于同名方法位（与 brand 面同口径）
    if (props.has(name)) continue;
    // Bug 831：真实声明优先（提升成员不得抢真实导出的名字）
    if (real.has(declNameKey(scope, name))) continue;
    const first = decls[0]!;
    if (first.questionToken) {
      // Bug 977：可选方法在 brand 面是 `fn | undefined` ⇒ 提升面同口径
      ctx.pending.push({ t: "var", scope, name, typeNode: optionalMethodTypeNode(first) });
      ctx.symbols++;
      continue;
    }
    ctx.pending.push({ t: "fn", scope, name, decls });
    ctx.symbols++;
  }
  for (const [name, member] of props) {
    // Bug 831：真实声明优先
    if (real.has(declNameKey(scope, name))) continue;
    // Bug 808：可选属性在 brand 面是 `T | undefined` ⇒ 提升面同口径
    ctx.pending.push({ t: "var", scope, name, typeNode: optionalPropTypeNode(member) });
    ctx.symbols++;
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
  // Bug 806：递归别名（自引用 / 互引）不能靠 depth 硬展开——展开是指数级的
  // （6 个自引用成员 ⇒ 54MB env 模块），且末层折成 unknown。
  // ⇒ 递归别名登记成**合成 interface**（成员面照搬，引用点走 instanceFor 的
  // 自引用守卫 ⇒ 按名 brand 引用，不内联展开）。
  registerRecursiveAliases(ctx, name);
}

// ---------------------------------------------------------------------------
// Recursive type aliases（Bug 806）
// ---------------------------------------------------------------------------

/** 合成 interface 标记：该 interface 的成员面「形状待定」（不是「确定没有成员」） */
const RECURSIVE_ALIAS_MARKER = "__nudoRecursiveAlias";

/** alias 声明 → 它引用的类型名（语法扫描；按声明缓存） */
const aliasRefsCache = new WeakMap<ts.TypeAliasDeclaration, Set<string>>();

/** ctx → 已确认递归的别名名（单调增长；收集期累积） */
const recursiveAliasCache = new WeakMap<HarvestContext, Set<string>>();

/** alias 声明引用的类型名（type reference 的名字，含限定名） */
function aliasRefNames(decl: ts.TypeAliasDeclaration): Set<string> {
  const hit = aliasRefsCache.get(decl);
  if (hit) return hit;
  const out = new Set<string>();
  const visit = (n: ts.Node | undefined): void => {
    if (!n) return;
    if (ts.isTypeReferenceNode(n)) out.add(typeNameString(n.typeName));
    n.forEachChild(visit);
  };
  visit(decl.type);
  aliasRefsCache.set(decl, out);
  return out;
}

/** 一个别名的全部声明合起来的引用名 */
function aliasRefsOf(ctx: HarvestContext, name: string): Set<string> {
  const out = new Set<string>();
  for (const decl of ctx.aliases.get(name) ?? []) {
    for (const r of aliasRefNames(decl)) out.add(r);
  }
  return out;
}

/** 从 `name` 的引用出发能否回到 `name`（别名图上的环） */
function aliasReachesSelf(ctx: HarvestContext, name: string, aliasNames: Set<string>): boolean {
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const r of aliasRefsOf(ctx, name)) if (aliasNames.has(r)) stack.push(r);
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === name) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const r of aliasRefsOf(ctx, cur)) if (aliasNames.has(r)) stack.push(r);
  }
  return false;
}

/**
 * 新登记一个别名后，检测新出现的别名环并登记合成 interface。
 *
 * 环只能**新**由这个别名引入（既有别名之间的环在它们各自登记时已检出），
 * 所以只查两条：新别名自身成环 / 既有别名经新别名成环。
 */
function registerRecursiveAliases(ctx: HarvestContext, newName: string): void {
  const aliasNames = new Set(ctx.aliases.keys());
  const known = recursiveAliasCache.get(ctx) ?? new Set<string>();
  const found: string[] = [];
  if (!known.has(newName) && aliasReachesSelf(ctx, newName, aliasNames)) {
    found.push(newName);
  }
  for (const name of aliasNames) {
    if (name === newName || known.has(name)) continue;
    if (!aliasRefsOf(ctx, name).has(newName)) continue;
    if (aliasReachesSelf(ctx, name, aliasNames)) found.push(name);
  }
  for (const name of found) {
    known.add(name);
    ensureRecursiveAliasInterface(ctx, name);
  }
  recursiveAliasCache.set(ctx, known);
}

/** 合成 interface 标记（成员面待定） */
function isRecursiveAliasDecl(decl: NamedTypeDecl): boolean {
  return (decl as unknown as Record<string, unknown>)[RECURSIVE_ALIAS_MARKER] === true;
}

/**
 * 为递归别名登记合成 interface。
 *
 * 成员面照搬别名的类型字面量成员（非类型字面量 ⇒ 无成员 ⇒ 成员面「待定」）；
 * 自引用点经 `mapTypeRef` → `instanceFor` 的自引用守卫 ⇒ 按名 brand 引用。
 */
function ensureRecursiveAliasInterface(ctx: HarvestContext, name: string): void {
  const decl = ctx.aliases.get(name)?.[0];
  if (!decl) return;
  const existing = ctx.interfaces.get(name) ?? [];
  if (existing.some((d) => isRecursiveAliasDecl(d))) return;
  const members = ts.isTypeLiteralNode(decl.type) ? [...decl.type.members] : [];
  const iface = ts.factory.createInterfaceDeclaration(
    undefined,
    ts.factory.createIdentifier(name),
    decl.typeParameters,
    undefined,
    ts.factory.createNodeArray(members),
  );
  (iface as unknown as Record<string, unknown>)[RECURSIVE_ALIAS_MARKER] = true;
  ctx.interfaces.set(name, [...existing, iface]);
}

// ---------------------------------------------------------------------------
// Phase 2: materialize Abs
// ---------------------------------------------------------------------------

/**
 * class 作为运行时值 = 构造函数：`new X()` 走 fnSig → instance。
 * 裸 instance 会被 new 的通用路径当作非函数 callee 退化为 unknown。
 *
 * Bug 826：必须带 **`ctor: true` facet** —— core 的 `new` 路径按 callee 的
 * `ctor` facet 判可构造性（`Shape k:"fn".ctor`）：缺省 = 「可构造性未知」
 * ⇒ 记 **may TypeError** ⇒ `new X()` 在 `tsc --strict` exit 0 的合法代码上
 * 被判「可能抛 TypeError」（L2 假红）。
 */
function classValueAbs(ctx: HarvestContext, cls: ts.ClassDeclaration, key: string): Abs {
  const ctor = (cls.members as readonly ts.ClassElement[]).find(ts.isConstructorDeclaration);
  const params: Abs[] = [];
  if (ctor) {
    for (const param of ctor.parameters) {
      // `this` 形参不是构造实参（且 TS 禁止在构造器里写 `this` 形参）⇒ 跳过
      if (isThisParameter(param)) continue;
      let type = param.type ? mapType(ctx, param.type, 0) : absUnknown();
      if (param.questionToken) type = absUnion([type, absUndefLit()]);
      params.push(type);
    }
  }
  // ctor facet（可构造）—— 走 absCtorSig（与「构造签名 ⇒ 可构造面」同一口径）
  return absCtorSig(params, instanceFor(ctx, key));
}

/**
 * 解析一个本地绑定（再导出 / default 别名的目标）为它的运行时值。
 *
 * 必须在**主物化循环之后**调用：本地绑定可能声明在另一个文件里
 * （符号表只有到那时才完整）⇒ 在收集阶段就判定「是不是值」，
 * 导出表会随 .d.ts 遍历顺序变（同一份声明换个文件顺序就少一个导出）—— Bug 820。
 */
function resolveLocalValue(ctx: HarvestContext, scope: Scope, key: string): Abs | undefined {
  const rec = recordFor(ctx, scope);
  if (Object.hasOwn(rec, key)) return rec[key];
  // 另一个作用域里的绑定（例如顶层声明被 `declare module "x" { export { X } }` 再导出）
  if (scope.moduleName !== undefined && Object.hasOwn(ctx.globals, key)) return ctx.globals[key];
  const cls = ctx.classes.get(key);
  if (cls) return classValueAbs(ctx, cls, key);
  // 纯类型（interface）：导出表保留它的实例面（与既有口径一致）
  if (ctx.interfaces.has(key) || ctx.qualifiedInterfaces.has(key)) return instanceFor(ctx, key);
  return undefined;
}

/**
 * overload 集的参数位：保留**每个** overload 的参数类型（逐位 union），
 * 而不是只取第一个 overload 的参数 —— TS 的 overload 是签名列表，
 * 只取 `sigs[0]` 会把其余 overload 的参数语义整条抹掉（Bug 827）。
 *
 * 仅在所有 overload **参数个数相同**、且参数类型里**没有泛型 α** 时才合并：
 * 参数个数变了会改掉 arity；α 是逐参数绑定的，union 参数会破坏绑定。
 */
function mergeOverloadParams(sigs: Abs[]): Abs[] | undefined {
  const first = sigs[0];
  if (!first || first.shape.k !== "fn") return undefined;
  const base = first.shape.paramTypes ?? [];
  if (base.length === 0) return undefined;
  const perPos: Abs[][] = base.map(() => []);
  for (const s of sigs) {
    if (s.shape.k !== "fn") return undefined;
    const pts = s.shape.paramTypes ?? [];
    if (pts.length !== base.length) return undefined;
    for (let i = 0; i < pts.length; i++) {
      const t = pts[i]!;
      if (hasTypeVar(t)) return undefined;
      perPos[i]!.push(t);
    }
  }
  return perPos.map((ts) => (ts.length === 1 ? ts[0]! : absUnion(ts)));
}

/**
 * 合并两条模块记录（`over` 的键优先）：无原型表 —— 导出名可能撞原型成员
 * （`__proto__` / `constructor` / `toString`），裸展开会读穿原型链（Bug 836）。
 */
function mergeModuleRecords(base: Record<string, Abs>, over: Record<string, Abs>): Record<string, Abs> {
  const merged = nullDict<Abs>();
  for (const k of Object.keys(base)) merged[k] = base[k]!;
  for (const k of Object.keys(over)) merged[k] = over[k]!;
  return merged;
}

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

  // 命名空间对象（Bug 793）：记录「pending → 槽位表」，供 2b 之后再回填
  // （命名空间里的 `export { X }` 在 2b 才解析进 nsRec）。
  const nsSlots: Array<{ rec: Record<string, Abs>; slots: Record<string, Slot> }> = [];

  for (const p of ctx.pending) {
    if (p.t === "iface-expand") continue;
    const rec = recordFor(ctx, p.scope);
    if (p.t === "ns") {
      // 命名空间对象：运行时成员留在 `NS.member` 面（**不摊平**进外层记录）
      const names = Object.keys(p.rec);
      if (names.length === 0) {
        // 只有类型（interface / type）的命名空间没有运行时成员 ⇒ 不产生对象
        // （否则 `declare namespace _ { interface X {} }` 会凭空多出一个全局 `_`）
        continue;
      }
      const slots = nullDict<Slot>();
      for (const n of names) slots[n] = { value: p.rec[n]! };
      const existing = rec[p.name];
      if (existing === undefined) {
        rec[p.name] = objOf(slots);
      } else if (existing.shape.k === "fn") {
        // 函数 + 命名空间同名（TS 的 function-namespace 合并）：
        // 命名空间成员是该值的静态成员，不另造一个同名对象
        (existing.shape as { slots?: Record<string, Slot> }).slots = slots;
      } else {
        // 同名的非函数值（const / class …）：命名空间成员无处安放 ⇒ 如实计数
        ctx.skipped++;
        continue;
      }
      nsSlots.push({ rec: p.rec, slots });
      continue;
    }
    if (p.t === "fn") {
      if (rec[p.name] !== undefined) continue; // same name already handled (first wins)
      // 多 overload：分别算签名（保留各自 typeParams），再 join 返回位
      // ——禁止在 materialize 里二次 mapType（那时 typeParams 已清空，T→unknown）
      const sigs = p.decls.map((d) => signatureToFnSig(ctx, d));
      const value = sigs[0]!;
      const shape0 = value.shape.k === "fn" ? value.shape : undefined;
      if (shape0 && sigs.length > 1) {
        // 参数位：保留每个 overload 的参数类型（逐位 union），不再只取第一个 overload 的参数
        // ——TS 的 overload 是签名列表，只取 sigs[0] 会把其余 overload 的参数语义整条抹掉
        //（Bug 827）。
        const mergedParams = mergeOverloadParams(sigs);
        if (mergedParams) {
          shape0.paramTypes = mergedParams;
          const rel0 = getFnImpl(value)?.relation;
          if (rel0) rel0.paramTypes = mergedParams;
        }
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
        // Bug 804：类型判不出（映射类型 / 模板字面量类型 / 索引访问类型 /
        // keyof / typeof …）⇒ `mapType` 退成 `unknown`。**绑定必须保留**：
        // 收割 env 是分析面唯一的全局事实来源，绑定被删 ⇒ 用户代码引用它
        // 就是自由标识符 ⇒ 引擎判「**确定抛 ReferenceError**」（L2 假红）。
        //
        // 「类型未建模」是**降级**（值域未知），不是「符号不存在」⇒ 不计入
        // skipped（丢了才计入）。保留 unknown 绑定还避免了遮蔽 evaluator
        // 内置的问题：遮蔽只发生在**同名**时，而同名内置（URL 等）在
        // .d.ts 里本来就有可映射的类型，不会走到这条降级路径。
        const mapped = p.typeNode ? mapType(ctx, p.typeNode, 0) : absUnknown();
        rec[p.name] = mapped;
        break;
      }
      case "value": {
        // class 作为运行时值 = 构造函数：new X() 走 fnSig → instance。
        // 裸 instance 会被 new 的通用路径当作非函数 callee 退化为 unknown。
        const key = p.lookup ?? p.name;
        const cls = ctx.classes.get(key);
        if (cls) {
          rec[p.name] = classValueAbs(ctx, cls, key);
          // 再导出 / default 别名是新导出条目（class 自身的声明已在收集阶段计数）
          if (p.lookup !== undefined) ctx.symbols++;
          break;
        }
        if (p.lookup !== undefined) {
          // 再导出 / default 别名：本地绑定可能还没物化（声明在另一个文件里），
          // 也可能不是 class（函数 / const / enum / interface）⇒ 统一在主循环之后解析，
          // 那时符号表已完整，导出表才不依赖 .d.ts 遍历顺序（Bug 815 / 820）。
          break;
        }
        rec[p.name] = instanceFor(ctx, key);
        break;
      }
      case "enum":
        rec[p.name] = absUnknown();
        break;
    }
  }

  // 2b) 解析「再导出 / default 别名」：`export { X as Y }` / `export default X` / `export = X`。
  // 「是不是值」在这里判定（符号表已完整）⇒ 导出表与 .d.ts 遍历顺序无关（Bug 820）；
  // 解析不出来的（纯类型 / 名字找不到）计入 skipped ⇒ 汇总行如实反映丢失（Bug 818 / 824）。
  for (const p of ctx.pending) {
    if (p.t !== "value" || p.lookup === undefined) continue;
    const rec = recordFor(ctx, p.scope);
    if (Object.hasOwn(rec, p.name)) continue;
    const resolved = resolveLocalValue(ctx, p.scope, p.lookup);
    if (resolved === undefined) {
      ctx.skipped++;
      continue;
    }
    rec[p.name] = resolved;
    ctx.symbols++;
  }

  // 2c) 命名空间成员回填（Bug 793）：命名空间里的 `export { X }` 在 2b 才
  // 解析进 nsRec ⇒ 把新增的成员补进命名空间对象的槽位表（槽位表是**活**的，
  // 对象本身不被替换 ⇒ 2b 之前拿到该对象的引用仍然有效）。
  for (const { rec: nsRec, slots } of nsSlots) {
    for (const [k, v] of Object.entries(nsRec)) {
      if (Object.hasOwn(slots, k)) continue;
      slots[k] = { value: v };
    }
  }

  // Apply module aliases (`declare module "fs" { export * from "node:fs"; }`
  // and the `export = path` form).
  // 别名与模块**自有声明合并**（自有的优先）：旧的「整记录替换」（`!ctx.modules[alias]` 守卫）
  // 会让「有自有声明的模块」把星号再导出的名字整批丢掉（Bug 817）。
  // 解析顺序按依赖（目标先于别名）：`a → b → c` 必须先算出 c，否则 a 拿到的是 b 的旧记录。
  const aliasTargets = new Map<string, string[]>();
  for (const [alias, target] of ctx.moduleAliases) {
    const list = aliasTargets.get(alias);
    if (list) {
      if (!list.includes(target)) list.push(target);
    } else {
      aliasTargets.set(alias, [target]);
    }
  }
  const aliasResolved = new Map<string, Record<string, Abs>>();
  const aliasResolving = new Set<string>();
  const resolveModule = (name: string, depth: number): Record<string, Abs> | undefined => {
    const cached = aliasResolved.get(name);
    if (cached) return cached;
    if (depth > MAX_ALIAS_DEPTH || aliasResolving.has(name)) return undefined; // 别名环
    aliasResolving.add(name);
    const own = ctx.modules[name];
    const targets = aliasTargets.get(name);
    let merged: Record<string, Abs> | undefined;
    if (targets) {
      for (const target of targets) {
        const t = resolveModule(target, depth + 1);
        if (!t) continue;
        // 纯别名（目标只有一条）⇒ 共用同一条记录（落盘面仍然去重）
        merged = merged ? mergeModuleRecords(merged, t) : t;
      }
    }
    aliasResolving.delete(name);
    if (!merged) return own;
    const out = own && Object.keys(own).length > 0 ? mergeModuleRecords(merged, own) : merged;
    aliasResolved.set(name, out);
    return out;
  };
  for (const name of aliasTargets.keys()) {
    const out = resolveModule(name, 0);
    if (out) ctx.modules[name] = out;
  }
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/**
 * 实体名 → 名字串（`A` / `A.B` / `A.B.C`）。
 *
 * 类的 `extends` 子句里基类名是**表达式**（`class X extends A.B {}` ⇒
 * PropertyAccessExpression），不是实体名（接口的 `extends A.B` 才是
 * QualifiedName）⇒ 这里两种形态都收，否则读 `.left` 会炸。
 */
function typeNameString(name: ts.EntityName | ts.PropertyAccessExpression): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) {
    const left = name.expression;
    // `this.X` 之类不是可引用的类型名 ⇒ 不可解析
    if (!ts.isIdentifier(left) && !ts.isPropertyAccessExpression(left)) return name.name.text;
    return `${typeNameString(left)}.${name.name.text}`;
  }
  return `${typeNameString(name.left)}.${name.right.text}`;
}

function memberName(node: { name?: ts.PropertyName }): string | undefined {
  const n = node.name;
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return undefined; // computed / private names
}

/**
 * brand 的「按名引用 + 形状待定」形态。
 *
 * 递归自引用不能铸成**闭合空对象**（`absBrand(name, {})`）：闭合空对象 =
 * 「该对象确定没有这个成员」⇒ 成员读走「槽位缺失 ⇒ exact undefined」⇒
 * 合法代码被判「定抛 TypeError」（L2 门禁假红，Bug 812）。
 * 落盘面（emitAbs）早已把递归引用兜成 `shape: unknown` ⇒ 内存收割面必须同口径。
 */
function absBrandOpen(name: string): Abs {
  return absExact({ k: "brand", name, shape: absUnknown() });
}

/** Abs 指纹（结构 + α term 身份）——泛型实例化缓存键用 */
function absFingerprint(a: Abs): string {
  const key = absShapeKey(a);
  const term = a.term && a.term.op !== "lit" ? termToString(a.term) : "";
  return term ? `${key}#${term}` : key;
}

/** 成员表：无原型（成员名 toString / constructor / __proto__ 不得命中原型链） */
function memberDict(): Record<string, Abs> {
  return Object.create(null) as Record<string, Abs>;
}

/**
 * 有效类型实参：显式实参 > 类型形参默认值 > 约束。
 *
 * 类型形参默认值（`interface Box<T extends string = string>`）此前**从不读取**
 * ⇒ 无参引用（`Box`）留下**未绑定 α**（T）⇒ 引擎侧「未绑定 α」= 无约束值 ⇒
 * 其上的任意方法调用被建模为定抛 TypeError（L2 门禁假红，Bug 813）。
 * TS 语义：无显式实参 ⇒ 取默认值；无默认值 ⇒ 取约束；两者皆无 ⇒ 推断 unknown。
 */
function effectiveTypeArgs(
  ctx: HarvestContext,
  decls: readonly NamedTypeDecl[],
  typeArgs: Abs[] | undefined,
): Abs[] {
  const tps = decls[0]?.typeParameters ?? [];
  if (tps.length === 0) return [];
  const out: Abs[] = [];
  for (let i = 0; i < tps.length; i++) {
    const tp = tps[i]!;
    const explicit = typeArgs?.[i];
    if (explicit !== undefined) {
      out.push(explicit);
      continue;
    }
    if (tp.default) {
      out.push(mapType(ctx, tp.default, 0));
      continue;
    }
    if (tp.constraint) {
      const c = mapType(ctx, tp.constraint, 0);
      out.push(isPlainUnknown(c) ? absUnknown() : c);
      continue;
    }
    out.push(absUnknown());
  }
  return out;
}

/**
 * 重载合并：保留**每个** overload 的参数位（逐位 union）+ 返回位并集。
 *
 * 与 materialize 的顶层函数分支同口径（同一实体两条收割路径必须同形）：
 * 参数位复用 `mergeOverloadParams`（Bug 827），返回位取并集（带 α 的返回优先）。
 * 旧实现按**名字**去重（first overload wins）⇒ 第二个 overload 的返回类型
 * 被**整体抹除**（假红 + 假绿，与 TS 完全倒置，Bug 805）。
 */
function mergeOverloadSigs(sigs: Abs[]): Abs {
  const first = sigs[0];
  if (!first) return absUnknown();
  if (sigs.length === 1) return first;
  if (first.shape.k !== "fn") return first;
  const params = mergeOverloadParams(sigs) ?? first.shape.paramTypes ?? [];
  const returns: Abs[] = [];
  for (const s of sigs) {
    if (s.shape.k !== "fn") continue;
    const ret = s.shape.returnType;
    if (ret && !isPlainUnknown(ret)) returns.push(ret);
  }
  const withVars = returns.filter((r) => hasTypeVar(r));
  const pool = withVars.length > 0 ? withVars : returns;
  const mergedRet = pool.length > 0 ? absUnion(pool) : absUnknown();
  const rel0 = getFnImpl(first)?.relation;
  const extra = rel0
    ? {
        ...(rel0.inferFrom ? { inferFrom: rel0.inferFrom } : {}),
        ...(rel0.condFallback !== undefined ? { condFallback: rel0.condFallback } : {}),
      }
    : undefined;
  return absFnSig(params, mergedRet, extra);
}

function instanceFor(ctx: HarvestContext, key: string, typeArgs?: Abs[]): Abs {
  const decls = interfaceDeclsOf(ctx, key);
  const decl = decls[0];
  if (!decl) return absUnknown();
  if (ctx.expanding.has(key)) {
    // Recursion guard: reference by name, shape pending (not "no members").
    // See absBrandOpen — an empty closed brand reads back as exact undefined
    // ⇒ legal code gets flagged as a definite TypeError (L2 false red).
    return absBrandOpen(decl.name?.text ?? key);
  }
  ctx.expanding.add(key);
  // 接口自身泛型形参（Map<K,V> 的 K/V）进入 typeParams，成员签名才能映射成 var
  const savedTp = ctx.typeParams;
  ctx.typeParams = new Set(savedTp);
  try {
    for (const d of decls) {
      for (const tp of d.typeParameters ?? []) ctx.typeParams.add(tp.name.text);
    }
    // Bug 813：有效类型实参（显式 > 默认值 > 约束）
    const effective = effectiveTypeArgs(ctx, decls, typeArgs);
    // Bug 791：缓存键必须编码类型实参的**身份**（实参个数不够——同一接口的
    // 不同实参会命中同一条缓存 ⇒ Box<number> 被折成 Box<string>）
    const cacheKey = effective.length > 0
      ? `${key}::${effective.map(absFingerprint).join("|")}`
      : key;
    const cached = ctx.instanceCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const properties: Record<string, Abs> = memberDict();
    // 同名方法的 overload 集（Bug 805：重载集全部保留，不再按名去重）
    const methodSigs = new Map<string, Abs[]>();
    // Bug 977：可选**方法**成员的可省性（与可选属性同口径）。
    // 属性分支读 `member.questionToken`、方法分支此前**不读** ⇒ `m?(): void`
    // 被建模成「必定存在的 () => void」⇒ `nudo check` 放行（`tsc --strict` 对
    // 同一行报 TS2722 ⇒ 假绿）。true = 该名字目前只见过可选形态。
    const optionalMethods = new Map<string, boolean>();
    // 合并全部 augmentation 成员（lodash LoDashStatic 跨 common/*.d.ts）
    for (const d of decls) {
      const members = d.members as readonly (ts.TypeElement | ts.ClassElement)[];
      for (const member of members) {
        const modifiers = (member as { modifiers?: readonly { kind: ts.SyntaxKind }[] }).modifiers;
        if (modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)) continue;
        if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
          // Bug 832：计算成员名（`[Symbol.iterator]`）也要收（迭代协议）
          const name = memberName(member) ?? computedMemberName(member.name);
          if (name === undefined) continue;
          let type = member.type ? mapType(ctx, member.type, 0) : absUnknown();
          if (member.questionToken) type = absUnion([type, absUndefLit()]);
          properties[name] = type;
          methodSigs.delete(name); // 属性位优先于同名方法位（与旧口径一致）
          optionalMethods.delete(name);
        } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
          // Bug 832：计算成员名（`[Symbol.iterator]()`）也要收（迭代协议）
          const name = memberName(member) ?? computedMemberName(member.name);
          if (name === undefined) continue;
          if (properties[name] !== undefined) continue; // 属性位已占位
          const sig = signatureToFnSig(ctx, member);
          // Bug 805：重载集**全部保留**（按名去重会把第二个 overload 的返回
          // 类型整体抹除）——按 materialize 的 fn 分支口径合并（参数位逐位
          // union + 返回位并集）
          const list = methodSigs.get(name);
          if (list) list.push(sig);
          else methodSigs.set(name, [sig]);
          // Bug 977：可选标记（必选形态出现时取消「可选」——TS：必选覆盖可选）
          optionalMethods.set(
            name,
            (optionalMethods.get(name) ?? true) && member.questionToken !== undefined,
          );
        } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
          const name = memberName(member) ?? computedMemberName(member.name);
          if (name === undefined || properties[name] !== undefined || !member.type) continue;
          properties[name] = mapType(ctx, member.type, 0);
        }
        // call / construct / index signatures are not representable — skipped.
      }
    }
    for (const [name, sigs] of methodSigs) {
      // Bug 977：可选方法读出 `fn | undefined`（与可选属性同口径）
      const merged = mergeOverloadSigs(sigs);
      properties[name] = optionalMethods.get(name)
        ? absUnion([merged, absUndefLit()])
        : merged;
    }
    // 递归别名的合成 interface：成员面不可知（非类型字面量 ⇒ 无成员可搬）
    // ⇒ brand 形状待定（不是闭合空对象）；成员面已知时照常带成员。
    const opaque = isRecursiveAliasDecl(decl) && Object.keys(properties).length === 0;
    let value = opaque
      ? absBrandOpen(decl.name?.text ?? key)
      : absBrand(decl.name?.text ?? key, properties);
    // 仅小接口做 α 实例化；LoDashStatic/Chain 等巨型接口 substAbs 会 OOM
    if (effective.length > 0 && Object.keys(properties).length <= 40) {
      const map = new Map<string, Abs>();
      const tps = decls[0]!.typeParameters ?? [];
      tps.forEach((tp, i) => {
        const arg = effective[i];
        if (arg) map.set(tp.name.text, arg);
      });
      if (map.size > 0) value = substAbs(value, map);
    }
    ctx.instanceCache.set(cacheKey, value);
    return value;
  } finally {
    ctx.typeParams = savedTp;
    ctx.expanding.delete(key);
  }
}

/**
 * `this` 形参**不是**调用方传的实参（TS：它是调用上下文的类型标注）。
 *
 * TypeScript 把 `this: T` 建模成**普通的 ParameterDeclaration**（名字就是标识符
 * `this`，`originalKeywordKind` 不置位），不显式跳过就与真形参无法区分 ⇒
 * 收割时它占掉第 0 个槽位：元数 +1、第一个真实实参被绑到 `this` 槽（Bug 794）。
 *
 * `this` 是 JS 保留字 ⇒ 不可能有同名真形参（`function f(this) {}` 是语法错误），
 * 判据用标识符文本即可。
 */
function isThisParameter(param: ts.ParameterDeclaration): boolean {
  const name = param.name;
  return ts.isIdentifier(name) && name.text === "this";
}

function signatureToFnSig(ctx: HarvestContext, sig: ts.SignatureDeclaration): Abs {
  const savedTp = ctx.typeParams;
  ctx.typeParams = new Set(savedTp);
  for (const tp of sig.typeParameters ?? []) {
    ctx.typeParams.add(tp.name.text);
  }
  try {
    // Bug 794：`this` 形参跳过（不是实参 ⇒ 不占参数位、不改元数）
    const paramTypes = sig.parameters.filter((param) => !isThisParameter(param)).map((param) => {
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
    const cond = ctx.pendingCond;
    ctx.pendingCond = undefined;
    return absFnSig(paramTypes, returnType, cond
      ? {
          inferFrom: { fromVar: cond.fromVar, via: cond.via, inferVar: cond.inferVar },
          condFallback: cond.fallback,
        }
      : undefined);
  } finally {
    ctx.typeParams = savedTp;
  }
}

function mapTypeMembers(
  ctx: HarvestContext,
  members: readonly ts.TypeElement[],
  depth: number,
  bindings?: Map<string, Abs>,
): { properties: Record<string, Abs>; index?: { key: Abs; value: Abs } } {
  const properties: Record<string, Abs> = {};
  let index: { key: Abs; value: Abs } | undefined;
  // Bug 819：访问器**读 / 写语义分开建模**。读面来自 getter（TS 的
  // `getTypeOfSymbol` 对 get/set 对取 getter 的返回类型），写面来自
  // setter 的形参类型。**getter 优先且与声明顺序无关** ⇒ 访问器对
  // （`set` 在前 / `get` 在后）也拿到正确的读面。
  const accessorReads = new Map<string, Abs>();
  const accessorWrites = new Map<string, Abs>();
  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      // Bug 832：计算成员名（`[Symbol.iterator]`）也要收（迭代协议）
      const name = memberName(member) ?? computedMemberName(member.name);
      if (name === undefined) continue;
      let type = member.type ? mapType(ctx, member.type, depth, bindings) : absUnknown();
      if (member.questionToken) type = absUnion([type, absUndefLit()]);
      properties[name] = type;
    } else if (ts.isMethodSignature(member)) {
      // Bug 832：计算成员名（`[Symbol.iterator]()`）也要收（迭代协议）
      const name = memberName(member) ?? computedMemberName(member.name);
      if (name === undefined || properties[name] !== undefined) continue; // first overload wins
      const sig = signatureToFnSig(ctx, member);
      // Bug 977：可选**方法**成员的可省性（与可选属性同口径）——
      // 此前方法分支不查 `questionToken` ⇒ `m?(): void` 被断言成「必定存在」。
      properties[name] = member.questionToken
        ? absUnion([sig, absUndefLit()])
        : sig;
    } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      // Bug 819：内联类型字面量的访问器成员（此前整条跳过 ⇒ 成员从**闭合**
      // 对象上读出 exact undefined；interface 路径 instanceFor 有同款分支 ⇒
      // 两条成员收集路径口径不一致）。
      const name = memberName(member) ?? computedMemberName(member.name);
      if (name === undefined) continue;
      if (ts.isGetAccessorDeclaration(member)) {
        // 读面 = getter 的返回类型
        accessorReads.set(
          name,
          member.type ? mapType(ctx, member.type, depth, bindings) : absUnknown(),
        );
      } else {
        // 写面 = setter 的形参类型（只有 setter 时读面是 undefined ⇒ 建模成
        // 「可选值」，不折 exact undefined 的自信错值）
        const param = member.parameters[0];
        accessorWrites.set(
          name,
          param?.type ? mapType(ctx, param.type, depth, bindings) : absUnknown(),
        );
      }
    } else if (ts.isIndexSignatureDeclaration(member)) {
      // Bug 803：索引签名 → **开放**对象 + 索引值域（此前是闭空对象 ⇒
      // 成员读出 exact undefined ⇒ 链式读取定抛 TypeError）
      const keyParam = member.parameters[0];
      const key = keyParam?.type
        ? mapType(ctx, keyParam.type, depth, bindings)
        : absPrim("string");
      const value = member.type ? mapType(ctx, member.type, depth, bindings) : absUnknown();
      index = { key, value };
    }
    // call / construct signatures: projected at the type-literal level (mapType)
  }
  // 访问器落到成员面（getter 优先；属性位已占位则不覆盖）
  for (const [name, read] of accessorReads) {
    if (properties[name] === undefined) properties[name] = read;
  }
  for (const [name, write] of accessorWrites) {
    if (properties[name] === undefined) {
      properties[name] = absUnion([write, absUndefLit()]);
    }
  }
  return { properties, index };
}

// ---------------------------------------------------------------------------
// H1 helpers: 类型形参作用域 / 开放对象 / extends 判定
// ---------------------------------------------------------------------------

/** 括号节点穿透（`(infer E)[]` 与 `infer E[]` 同义） */
function stripParens(node: ts.TypeNode): ts.TypeNode {
  let n = node;
  while (ts.isParenthesizedTypeNode(n)) n = n.type;
  return n;
}

/** 文件路径 → 稳定短盐（FNV-1a）：跨文件的同名类型形参不撞 α id */
function fileSaltOf(fileName: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < fileName.length; i++) {
    h ^= fileName.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 作用域节点的稳定短 tag（文件盐 + 位置） */
function scopeTagOf(scope: ts.Node): string {
  let file = "";
  try {
    file = scope.getSourceFile()?.fileName ?? "";
  } catch {
    file = "";
  }
  return `${fileSaltOf(file)}${scope.pos}`;
}

/**
 * 类型形参的 α 身份（**作用域隔离**，Bug 810）。
 *
 * TS 的类型形参**就近遮蔽**：`interface Shadow<T> { v: T; m<T>(x: T): T }`
 * 里方法自己的 `<T>` 遮蔽接口的 `<T>`。收割器把两者放进同一个扁平
 * `ctx.typeParams` 集合 ⇒ 接口实参代入（`substAbs`）时把方法内部的 α
 * 一并替换 ⇒ 方法被**去泛型化**（`sh.m("text")` 折 number，真值 string）。
 *
 * 口径：**AST 链上最近的声明者胜**；同名若还被外层声明过（= 遮蔽），
 * 内层用**独立 id**（`T@<tag>`）⇒ 外层代入不再穿透它。
 */
function typeParamVarId(node: ts.Node, name: string): string {
  const scopes: ts.Node[] = [];
  let p: ts.Node | undefined = node.parent;
  while (p) {
    const tps = (p as { typeParameters?: readonly ts.TypeParameterDeclaration[] }).typeParameters;
    if (tps) {
      for (const tp of tps) {
        if (tp.name.text === name) {
          scopes.push(p);
          break;
        }
      }
    }
    p = p.parent;
  }
  // 唯一声明（或无 AST 证据）→ 原名：可被外层代入
  if (scopes.length <= 1) return name;
  // 遮蔽 → 最近声明者拿独立身份（TS 就近遮蔽）
  return `${name}@${scopeTagOf(scopes[0]!)}`;
}

/** 开放对象（索引签名 / `Record`）：带索引值域，成员读不折 exact undefined */
function absOpenObj(
  properties: Record<string, Abs>,
  index?: { key: Abs; value: Abs },
): Abs {
  const slots: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(properties)) {
    slots[k] = { value: v };
  }
  return objOf(slots, index ? { index, open: true } : { open: true });
}

/** Abs 的成员表（obj 形状 / brand 的内层 obj） */
function slotsOfAbs(a: Abs): Record<string, Abs> | undefined {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slotsOfAbs(s.shape);
  return undefined;
}

/** 两个 Abs 是否同型（展示面比较：收割面的结构等价判定） */
function sameAbsType(a: Abs, b: Abs): boolean {
  if (a === b) return true;
  return formatShape(a) === formatShape(b);
}

/**
 * 交叉类型 `A & B` → 成员**并集**（Bug 799）。
 *
 * 两侧都是对象面（obj / brand 的内层 obj）时合并槽位；同名冲突成员按
 * TS 取交集（同类型保留；不同类型 ⇒ never）。
 */
function mergeIntersection(members: Abs[]): Abs | undefined {
  const slots: Record<string, Abs> = {};
  let merged = 0;
  for (const member of members) {
    const mSlots = slotsOfAbs(member);
    if (!mSlots) return undefined; // 不可展开 → 交回调用方兜底
    merged++;
    for (const [key, value] of Object.entries(mSlots)) {
      if (!Object.hasOwn(slots, key)) {
        slots[key] = value;
        continue;
      }
      const prev = slots[key]!;
      if (!sameAbsType(prev, value)) slots[key] = absNever(); // 冲突 ⇒ never
    }
  }
  if (merged === 0) return undefined;
  return absObj(slots);
}

/**
 * 构造签名 ⇒ **仅可构造**的 fn 面（Bug 829）。
 *
 * `ctor: true` 让 `new C(1)` 走核心的构造分支（不再记 may-throw ⇒ L2
 * 假红消除）；`paramTypes` / `returnType` 保留构造形参与实例面。
 * TS 的「不可裸调用」需要核心的 `callable` 面（本次不改 core），
 * 详见交付报告的越界说明。
 */
function absCtorSig(
  params: Abs[],
  instance: Abs,
  extra?: {
    inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
    condFallback?: Abs;
  },
): Abs {
  const a = absFnSig(params, instance, extra);
  // 只补 ctor facet（不碰 paramTypes / returnType 数组的双写纪律）
  (a.shape as { ctor?: boolean }).ctor = true;
  return a;
}

/**
 * 取出并清空上下文级的条件元数据（Bug 821）。
 *
 * 元数据**只允许被它自己的那条签名消费**：取出即清空 ⇒ 残留的元数据不会
 * 被下一条签名捡走（跨条目泄漏 ⇒ 逐字相同的两条声明得到不同类型 ⇒
 * 门禁冷缓存假红 / 热缓存绿）。
 */
function takePendingCond(ctx: HarvestContext): CondMeta | undefined {
  const cond = ctx.pendingCond;
  ctx.pendingCond = undefined;
  return cond;
}

/** 条件元数据 → `absFnSig` 的 extra 槽（inferFrom / condFallback） */
function condExtra(cond: CondMeta | undefined):
  | {
      inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
      condFallback?: Abs;
    }
  | undefined {
  if (!cond) return undefined;
  return {
    inferFrom: { fromVar: cond.fromVar, via: cond.via, inferVar: cond.inferVar },
    condFallback: cond.fallback,
  };
}

/**
 * 给 fn 面补**静态成员**（类型字面量里与调用 / 构造签名共存的具名成员）。
 *
 * TS 的 `{ (a: number): string; tag: boolean }` 是「可调用 **且** 有成员」的
 * 类型；此前投影成 fn 时把 `tag` **静默丢掉**（族 27 的「静默丢失」放大器：
 * 丢了还报「0 skipped」）。
 *
 * fn 形状的 `slots` 槽正是 core 为「双面全局」准备的（callable + 静态成员，
 * 见 core `exec/runtime/containers/member.ts` 的 dual-facet 读臂）。
 */
function attachFnSlots(fn: Abs, properties: Record<string, Abs>): Abs {
  const names = Object.keys(properties);
  if (names.length === 0) return fn;
  const slots: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(properties)) slots[k] = { value: v };
  (fn.shape as { slots?: Record<string, Slot> }).slots = slots;
  return fn;
}

/** `keyof T` 的键名集合（T 的成员名）；判不出时返回 undefined */
function keyofNamesOf(
  ctx: HarvestContext,
  node: ts.TypeNode,
  depth: number,
): string[] | undefined {
  const n = stripParens(node);
  if (ts.isTypeLiteralNode(n)) {
    const names: string[] = [];
    for (const member of n.members) {
      if (ts.isIndexSignatureDeclaration(member)) continue;
      const name = memberName(member);
      if (name !== undefined) names.push(name);
    }
    return names;
  }
  if (ts.isTypeReferenceNode(n)) {
    const name = typeNameString(n.typeName);
    if (ctx.interfaces.has(name) || ctx.qualifiedInterfaces.has(name)) {
      const slots = slotsOfAbs(instanceFor(ctx, name));
      return slots ? Object.keys(slots) : undefined;
    }
    const aliases = ctx.aliases.get(name) ?? ctx.qualifiedAliases.get(name) ?? [];
    const alias = aliases[0];
    if (alias) {
      const slots = slotsOfAbs(mapType(ctx, alias.type, depth + 1));
      return slots ? Object.keys(slots) : undefined;
    }
  }
  return undefined;
}

/** 内建泛型类型名（`extends` 位的可判定性判定用） */
const BUILTIN_TYPE_NAMES = new Set([
  "Array", "ReadonlyArray", "Promise", "PromiseLike", "Map", "ReadonlyMap", "WeakMap",
  "Set", "ReadonlySet", "WeakSet", "Record", "Partial", "Readonly", "Required", "Pick",
  "Omit", "Exclude", "Extract", "NonNullable", "Parameters", "ReturnType", "Awaited",
  "Iterable", "Iterator", "IterableIterator", "AsyncIterable", "AsyncIterator",
  "AsyncIterableIterator", "Generator", "AsyncGenerator", "Date", "RegExp", "Error",
  "JSON", "Object", "Function", "ArrayBuffer", "Uint8Array", "Int8Array", "Uint16Array",
  "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "ArrayLike", "List", "Collection", "Many",
  "NumericDictionary", "Dictionary",
]);

type TypeSide = "ok" | "unknownKeyword" | "degraded";

/**
 * 类型节点在 `extends` 位的**可判定性**（Bug 822）。
 *
 * - `ok`：能判（字面量 / prim / interface / 别名 / α / 可算的 `keyof`）
 * - `unknownKeyword`：真的 `unknown` 类型（任何类型都 extends 它 ⇒ 恒真）
 * - `degraded`：**退化哨兵**（`keyof` 判不出 / `typeof` / 映射类型 /
 *   索引访问 / 未解析的类型引用）—— 判不出时必须给 unknown（**不取支**），
 *   绝不能当 unknown 恒真（此前 `"z" extends keyof {a:1}` 恒判真 ⇒ 取错支）。
 */
function typeSideKind(ctx: HarvestContext, node: ts.TypeNode, depth: number): TypeSide {
  const n = stripParens(node);
  if (ts.isTypeOperatorNode(n)) {
    if (n.operator === ts.SyntaxKind.KeyOfKeyword) {
      return keyofNamesOf(ctx, n.type, depth) ? "ok" : "degraded";
    }
    if (n.operator === ts.SyntaxKind.ReadonlyKeyword) return typeSideKind(ctx, n.type, depth);
    return "degraded";
  }
  if (ts.isTypeQueryNode(n)) return "degraded";        // typeof X
  if (ts.isMappedTypeNode(n)) return "degraded";        // { [K in …]: … }
  if (ts.isIndexedAccessTypeNode(n)) return "degraded"; // T[K]
  if (ts.isImportTypeNode(n)) return "degraded";        // import("x")
  if (ts.isTemplateLiteralTypeNode(n)) return "degraded";
  if (ts.isConditionalTypeNode(n)) return "degraded";   // 嵌套条件类型：判不出
  if (ts.isUnionTypeNode(n)) {
    for (const t of n.types) {
      if (typeSideKind(ctx, t, depth) === "degraded") return "degraded";
    }
    return "ok";
  }
  if (ts.isTypeReferenceNode(n)) {
    const name = typeNameString(n.typeName);
    if (ctx.typeParams.has(name)) return "ok";         // α（按 var 另行处理）
    if (ctx.interfaces.has(name) || ctx.qualifiedInterfaces.has(name)) return "ok";
    if ((ctx.aliases.get(name) ?? ctx.qualifiedAliases.get(name) ?? []).length > 0) return "ok";
    if (BUILTIN_TYPE_NAMES.has(name)) return "ok";
    return "degraded";                                  // 未解析的类型引用
  }
  return "ok";
}

/**
 * 条件类型是否位于「签名返回位」（**直接**返回位）。
 *
 * 只有**直接**返回位的未决条件元数据该被 `signatureToFnSig` 消费；属性位 /
 * 类型位 / 形参位的元数据**不属于任何签名**——写进上下文级单槽会被
 * **下一条**签名捡走 ⇒ 逐字相同的两条声明得到不同类型 ⇒ 门禁结论随
 * 缓存状态翻转（Bug 821）。
 *
 * 「直接」的含义：条件类型节点**就是**该签名的返回类型节点（括号是透明的）。
 * 判「某个祖先是签名」是不够的 —— `function f(): { p: T extends X ? 1 : 2 }`
 * 里属性位的条件类型也会「在某个签名下面」，但它**不是**该签名的返回类型，
 * 写进单槽同样会被该签名捡走（属性位的元数据不属于任何签名）。
 *
 * 写集 = **会被 `signatureToFnSig`（或 mapType 的调用/构造签名分支）消费**的
 * 返回位：函数/方法声明、方法签名、函数类型、调用签名、构造签名。
 * 访问器（get/set）**不在**写集内 —— 它们的返回类型走 `mapType` 直接映射，
 * 没人消费单槽 ⇒ 写进去就是纯泄漏。
 */
function isSignatureReturnPos(node: ts.Node): boolean {
  // 括号透明：`(): (T extends X ? 1 : 2)` 的返回位仍是该签名。
  let cur: ts.Node = node;
  let p: ts.Node | undefined = cur.parent;
  while (p && ts.isParenthesizedTypeNode(p)) {
    cur = p;
    p = p.parent;
  }
  if (!p) return false;
  switch (p.kind) {
    case ts.SyntaxKind.FunctionType:
    case ts.SyntaxKind.ConstructorType:
      // 函数类型 / 构造类型的返回面在 `.type`（构造类型的是实例面）
      return (p as ts.FunctionTypeNode).type === cur;
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.CallSignature:
    case ts.SyntaxKind.ConstructSignature:
      return (p as ts.SignatureDeclaration).type === cur;
    default:
      // 形参位 / 属性位 / 访问器位 / 类型别名体 / 变量声明位 …⇒ 不是返回位
      return false;
  }
}

function mapTypeRef(
  ctx: HarvestContext,
  node: ts.TypeReferenceNode,
  depth: number,
  bindings?: Map<string, Abs>,
): Abs {
  const name = typeNameString(node.typeName);
  const args = node.typeArguments ?? [];
  // 泛型形参 T → var Abs（供 relationFn α 替换）
  if (ctx.typeParams.has(name) && args.length === 0) {
    // Bug 798：`infer` 绑定必须**替换**真支里的 `E` 引用 —— `T extends
    // (infer E)[] ? E : never` 的真支 `E` 在 AST 上是 **TypeReferenceNode**
    // （`infer E` 才是 InferTypeNode）⇒ 不查绑定表 ⇒ 真支退化成 α 变量
    // ⇒ 条件类型的值域丢失（`number[] extends (infer E)[] ? E : never`
    // 收割成 `any` 而不是 `number`）。
    const bound = bindings?.get(name);
    if (bound) return bound;
    // Bug 810：α 身份按**作用域**隔离（方法自己的 <T> 遮蔽外层同名 <T>）
    return typeVarAbs(typeParamVarId(node, name));
  }
  if ((name === "Array" || name === "ReadonlyArray") && args.length >= 1) {
    return absArr(mapType(ctx, args[0], depth, bindings));
  }
  // lodash List/ArrayLike/Collection/Many<T> 等未知容器：保 type arg 进 arr，供合一
  if (
    (name === "List" || name === "ArrayLike" || name === "Collection" || name === "Many" ||
      name === "NumericDictionary" || name === "Dictionary") &&
    args.length >= 1
  ) {
    return absArr(mapType(ctx, args[0], depth, bindings));
  }
  if (name === "Promise" && args.length >= 1) {
    return absPromise(mapType(ctx, args[0], depth, bindings));
  }
  // Map/Set 族：内建 brand（不依赖是否加载了 lib.es2015.collection）
  if (
    (name === "Map" || name === "ReadonlyMap" || name === "WeakMap") &&
    args.length >= 2
  ) {
    return absMapType(
      name,
      mapType(ctx, args[0], depth, bindings),
      mapType(ctx, args[1], depth, bindings),
    );
  }
  if ((name === "Set" || name === "ReadonlySet" || name === "WeakSet") && args.length >= 1) {
    return absSetType(name, mapType(ctx, args[0], depth, bindings));
  }
  if (name === "Record") {
    // Bug 803：`Record<K,V>` / 索引签名对象 → **开放**对象 + 索引值域
    // （此前是**闭**空对象 ⇒ 成员读出 exact undefined ⇒ 链式读取定抛
    // TypeError；两个不同 Record 收割成完全相同）。
    const value = args[1] ? mapType(ctx, args[1], depth, bindings) : absUnknown();
    const key = args[0] ? mapType(ctx, args[0], depth, bindings) : absPrim("string");
    return absOpenObj({}, { key, value });
  }
  if (ctx.interfaces.has(name) || ctx.qualifiedInterfaces.has(name)) {
    return instanceFor(ctx, name, args.map((a) => mapType(ctx, a, depth, bindings)));
  }
  const aliases = ctx.aliases.get(name) ?? ctx.qualifiedAliases.get(name) ?? [];
  const alias = aliases[0];
  if (alias) return mapAliasWithArgs(ctx, alias, args, depth, bindings);
  return absUnknown();
}

/**
 * 泛型别名按**类型实参实例化**（Bug 800）。
 *
 * 此前别名分支直接展开别名体、**丢弃实参** ⇒ `Box<number>` 与
 * `Box<string>` 收割成完全相同（成员值域都退化成 `unknown`）；同一文件里
 * 接口路径（`instanceFor`）却是会代入实参的 ⇒ 同一语义、不同路径的成对缺口。
 */
function mapAliasWithArgs(
  ctx: HarvestContext,
  alias: ts.TypeAliasDeclaration,
  args: readonly ts.TypeNode[],
  depth: number,
  bindings?: Map<string, Abs>,
): Abs {
  const tps = alias.typeParameters ?? [];
  if (tps.length === 0 || args.length === 0) return mapType(ctx, alias.type, depth + 1);
  const savedTp = ctx.typeParams;
  ctx.typeParams = new Set(savedTp);
  for (const tp of tps) ctx.typeParams.add(tp.name.text);
  try {
    const body = mapType(ctx, alias.type, depth + 1);
    const map = new Map<string, Abs>();
    tps.forEach((tp, i) => {
      const arg = args[i];
      if (!arg) return;
      // 键 = 别名体内该形参的 α 身份（与体内引用同口径 ⇒ 遮蔽时也对得上）
      map.set(
        typeParamVarId(alias.type, tp.name.text),
        mapType(ctx, arg, depth + 1, bindings),
      );
    });
    return map.size > 0 ? substAbs(body, map) : body;
  } finally {
    ctx.typeParams = savedTp;
  }
}

// ---------------------------------------------------------------------------
// Conditional types（T extends U ? X : Y / infer）
// ---------------------------------------------------------------------------

function collectInferNames(node: ts.TypeNode, out = new Set<string>()): Set<string> {
  const visit = (n: ts.Node | undefined): void => {
    if (!n) return;
    if (ts.isParenthesizedTypeNode(n)) {
      visit(n.type); // 括号穿透（`(infer E)[]` 与 `infer E[]` 同义，Bug 798）
      return;
    }
    if (ts.isInferTypeNode(n)) {
      out.add(n.typeParameter.name.text);
      visit(n.typeParameter.constraint);
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return out;
}

type ExtendsResult = "true" | "false" | "unknown";

/**
 * Abs 层 `extends` 判定（TS 语义：**可赋值性**，三分支）。
 *
 * - `"true"`：确定成立
 * - `"false"`：确定不成立
 * - `"unknown"`：**判不出**（α / 退化哨兵 / 结构不可比）⇒ 条件类型**不取支**
 *
 * 关键口径：
 * - **字面量按值比**（`"a" extends "b"` → false；`1 extends 1` → true；
 *   `1 extends number` → true）；**prim vs prim 才比标签**，且方向不能反
 *   （`number extends 1` → false）。此前只比 `shape.type` ⇒ 字面量信息
 *   （在 `term` 上）被忽略 ⇒ 判定**恒真**（Bug 797）。
 * - **brand vs brand 走结构**（同构即等），不能只比名字 ⇒ 结构相同的
 *   两个 interface 此前被判「不 extends」⇒ 条件类型**确定地**走错支
 *   （Bug 816）。
 */
function absExtends(check: Abs, ext: Abs, depth = 0): ExtendsResult {
  if (depth > 6) return "unknown";
  // α（类型形参 / infer 变量）→ 判不出
  if (check.term?.op === "var") return "unknown";
  const cs = check.shape;
  const es = ext.shape;
  const cIsLit = check.term?.op === "lit";
  const eIsLit = ext.term?.op === "lit";
  const cLit = check.term && check.term.op === "lit" ? check.term.value : undefined;
  const eLit = ext.term && ext.term.op === "lit" ? ext.term.value : undefined;

  // ---- 字面量位 ----
  if (cIsLit && eIsLit) {
    // 同值同型 → true；否则 false（"a" vs "b"、1 vs 2、1 vs "1"）
    return cLit === eLit && typeof cLit === typeof eLit ? "true" : "false";
  }
  if (cIsLit) {
    // 字面量 vs 类型：字面量可赋值给对应 prim（1 extends number → true）
    if (eIsLit && (eLit === null || eLit === undefined)) return "false"; // null/undefined 位
    if (es.k === "prim") {
      if (cLit === null) return "false";
      return typeof cLit === es.type ? "true" : "false";
    }
    if (es.k === "sum") {
      const flags = es.members.map((m) => absExtends(check, m, depth + 1));
      if (flags.some((f) => f === "true")) return "true";
      if (flags.every((f) => f === "false")) return "false";
      return "unknown";
    }
    if (es.k === "unknown") return "true"; // extends unknown
    if (es.k === "never") return "false";
    if (es.k === "any") return "unknown"; // any → 判不出
    return "unknown";
  }
  if (eIsLit) {
    // 类型 vs **具体**字面量：prim 不等于字面量（number extends 1 → false）
    return "false";
  }

  // ---- 非字面量位 ----
  if (es.k === "any") return "unknown";   // any：TS 走两支联合
  if (es.k === "unknown") return "true";  // extends unknown
  if (cs.k === "any") return "unknown";   // any extends X → 判不出
  if (cs.k === "unknown") return "false"; // unknown 不可赋给 X（X ≠ unknown）
  if (cs.k === "never") return "true";    // never 赋给任何类型
  if (es.k === "never") return "false";   // 只有 never 赋给 never
  if (es.k === "prim" && cs.k === "prim") {
    return cs.type === es.type ? "true" : "false";
  }
  if (es.k === "sum") {
    const flags = es.members.map((m) => absExtends(check, m, depth + 1));
    if (flags.some((f) => f === "true")) return "true";
    if (flags.every((f) => f === "false")) return "false";
    return "unknown";
  }
  if (cs.k === "sum") {
    const flags = cs.members.map((m) => absExtends(m, ext, depth + 1));
    if (flags.every((f) => f === "true")) return "true";
    if (flags.every((f) => f === "false")) return "false";
    return "unknown";
  }
  if (cs.k === "arr" && es.k === "arr") {
    return absExtends(cs.element, es.element, depth + 1);
  }
  if (cs.k === "tuple" && es.k === "arr") {
    const flags = cs.elements.map((el) => absExtends(el, es.element, depth + 1));
    return flags.some((f) => f === "false") ? "false" : "true";
  }
  if (cs.k === "tuple" && es.k === "tuple") {
    if (cs.elements.length !== es.elements.length) return "unknown";
    const flags = cs.elements.map((el, i) => absExtends(el, es.elements[i]!, depth + 1));
    if (flags.some((f) => f === "false")) return "false";
    if (flags.every((f) => f === "true")) return "true";
    return "unknown";
  }
  if (cs.k === "eff" && es.k === "eff" && cs.eff === es.eff) {
    return absExtends(cs.inner, es.inner, depth + 1);
  }
  if (cs.k === "brand" && es.k === "brand") {
    if (cs.name === es.name) return "true"; // 同名名义类型
    return structuralExtends(check, ext, depth); // 异名：结构比较（Bug 816）
  }
  if (
    (cs.k === "obj" && es.k === "obj") ||
    (cs.k === "brand" && es.k === "obj") ||
    (cs.k === "obj" && es.k === "brand")
  ) {
    return structuralExtends(check, ext, depth);
  }
  if (cs.k === "fn" && es.k === "fn") {
    const a = cs.returnType;
    const b = es.returnType;
    if (!a || !b) return "unknown";
    return absExtends(a, b, depth + 1);
  }
  return "unknown";
}

/** 结构化可赋值性（obj / brand 的成员逐槽比） */
function structuralExtends(check: Abs, ext: Abs, depth: number): ExtendsResult {
  const cs = slotsOfAbs(check);
  const es = slotsOfAbs(ext);
  if (!cs || !es) return "unknown";
  const extKeys = Object.keys(es);
  if (extKeys.length === 0) return "unknown"; // 无成员可比 → 判不出
  const flags: ExtendsResult[] = [];
  for (const key of extKeys) {
    const target = es[key]!;
    const source = cs[key];
    if (source === undefined) {
      flags.push("false"); // 目标成员在源上不存在 ⇒ 不可赋值
      continue;
    }
    flags.push(absExtends(source, target, depth + 1));
  }
  if (flags.some((f) => f === "false")) return "false";
  if (flags.every((f) => f === "true")) return "true";
  return "unknown";
}

/**
 * extends 模式 vs 实参：绑定 infer（E[] / Promise<U> / `{a: infer V}` 等）。
 *
 * **括号节点要穿透**：TS 的 `(infer E)[]` 里 `infer E` 外面套了一层
 * `ParenthesizedTypeNode`；此前不认括号节点 ⇒ `(infer E)[]` **不绑定** E，
 * 去掉括号就能绑 —— 同一语义只差一层括号（Bug 798）。
 */
function matchExtendsInfer(
  pattern: ts.TypeNode,
  actual: Abs,
  inferMap: Map<string, Abs>,
  depth = 0,
): ExtendsResult {
  if (depth > 6) return "unknown";
  const p = stripParens(pattern); // 括号穿透（Bug 798）
  if (ts.isInferTypeNode(p)) {
    const name = p.typeParameter.name.text;
    if (!inferMap.has(name)) inferMap.set(name, actual);
    return "true";
  }
  if (ts.isArrayTypeNode(p) && actual.shape.k === "arr") {
    return matchExtendsInfer(p.elementType, actual.shape.element, inferMap, depth + 1);
  }
  if (ts.isTypeReferenceNode(p)) {
    const name = typeNameString(p.typeName);
    const args = p.typeArguments ?? [];
    if (
      (name === "Array" || name === "ReadonlyArray" || name === "List" || name === "ArrayLike") &&
      args[0] &&
      actual.shape.k === "arr"
    ) {
      return matchExtendsInfer(args[0], actual.shape.element, inferMap, depth + 1);
    }
    if (name === "Promise" && args[0] && actual.shape.k === "eff" && actual.shape.eff === "promise") {
      return matchExtendsInfer(args[0], actual.shape.inner, inferMap, depth + 1);
    }
    return "unknown";
  }
  if (ts.isUnionTypeNode(p)) {
    const flags = p.types.map((t) => matchExtendsInfer(t, actual, inferMap, depth + 1));
    if (flags.some((f) => f === "true")) return "true";
    if (flags.every((f) => f === "false")) return "false";
    return "unknown";
  }
  if (ts.isTypeLiteralNode(p)) {
    // `{ a: infer V }` 模式：按成员名匹配对象的槽
    const slots = slotsOfAbs(actual);
    if (!slots) return "unknown";
    const flags: ExtendsResult[] = [];
    for (const member of p.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const name = memberName(member);
      if (name === undefined) continue;
      const source = slots[name];
      if (source === undefined) {
        flags.push("false");
        continue;
      }
      flags.push(matchExtendsInfer(member.type, source, inferMap, depth + 1));
    }
    if (flags.length === 0) return "unknown";
    if (flags.some((f) => f === "false")) return "false";
    if (flags.every((f) => f === "true")) return "true";
    return "unknown";
  }
  return "unknown";
}

/**
 * 条件类型求值（`T extends U ? X : Y` / `infer`）。
 *
 * 三分支口径（Bug 822）：`extends` 位**判不出**（退化哨兵：keyof 判不出 /
 * typeof / 映射类型 / 未解析类型）⇒ 结果 `"unknown"` ⇒ **不取支**（取两支
 * 并集），绝不能当 unknown 恒真。
 *
 * 未决时的 α 捷径（Bug 823）：只有「真支**就是** infer 变量」时才能用
 * （引擎在调用点绑定 α）；真支是**嵌套条件类型**时必须**递归求值** ——
 * 否则真支被 infer 变量顶替 ⇒ 返回与 TS 相反的确切字面量。
 *
 * 条件元数据的**归属**（Bug 821）：`ctx.pendingCond` 是上下文级单槽，
 * 只有**签名返回位**的条件类型才写它（属性位 / 类型位的元数据不属于任何
 * 签名 ⇒ 会被下一条签名捡走 ⇒ 逐字相同的两条声明得到不同类型 ⇒ 门禁
 * 结论随缓存状态翻转）。
 */
function mapConditionalType(
  ctx: HarvestContext,
  node: ts.ConditionalTypeNode,
  depth: number,
  bindings?: Map<string, Abs>,
): Abs {
  const inferMap = new Map<string, Abs>();
  const inferNames = collectInferNames(node.extendsType);

  const check = mapType(ctx, node.checkType, depth + 1, bindings);
  const astMatch = matchExtendsInfer(node.extendsType, check, inferMap);
  const extAbs = mapType(ctx, node.extendsType, depth + 1, bindings);

  // extends 位的三分支：退化哨兵 ⇒ 判不出（不取支）；真 `unknown` ⇒ 恒真
  const checkSide = typeSideKind(ctx, node.checkType, depth + 1);
  const extSide = typeSideKind(ctx, node.extendsType, depth + 1);
  let absMatch: ExtendsResult;
  if (extSide === "degraded" || checkSide === "degraded") {
    absMatch = "unknown";
  } else if (extSide === "unknownKeyword") {
    absMatch = "true"; // 任何类型都 extends unknown
  } else {
    absMatch = astMatch !== "unknown" ? astMatch : absExtends(check, extAbs);
  }

  // check 是 α 且 extends 是 (infer E)[] / Promise<infer U>：
  // 记在 ctx.pendingCond，供 signatureToFnSig 挂到 relation.inferFrom
  const condMeta = analyzeCondPattern(ctx, node, check);

  const savedTp = ctx.typeParams;
  ctx.typeParams = new Set(savedTp);
  for (const n of inferNames) ctx.typeParams.add(n);

  try {
    // 真支：infer 变量在真支里可见（TS 作用域）⇒ 绑定带进真支求值
    const trueBindings = new Map<string, Abs>(bindings ?? []);
    for (const [k, v] of inferMap) trueBindings.set(k, v);
    const trueAbs = mapType(ctx, node.trueType, depth + 1, trueBindings);
    const falseAbs = mapType(ctx, node.falseType, depth + 1, bindings);
    if (absMatch === "true") return trueAbs;
    if (absMatch === "false") return falseAbs;
    // 未决：真支**就是** infer 变量时才用 α 捷径（引擎在调用点绑定）
    if (condMeta && check.term?.op === "var" && trueBranchIsInferVar(node, condMeta)) {
      // 条件元数据只属于**产生它的那条声明**：只有签名返回位才写进
      // ctx.pendingCond（否则属性位 / 类型位的元数据会被下一条签名捡走）
      if (isSignatureReturnPos(node)) {
        ctx.pendingCond = { ...condMeta, fallback: falseAbs };
      }
      return typeVarAbs(condMeta.inferVar);
    }
    // 未决且真支不是 infer 变量 ⇒ 保守取两支并集（真支已递归求值）
    return absUnion([trueAbs, falseAbs]);
  } finally {
    ctx.typeParams = savedTp;
  }
}

/**
 * 真支是否**就是** infer 变量本身（`T extends (infer E)[] ? E : never`）。
 *
 * 真支里的 `E` 在 AST 上是 **TypeReferenceNode**（`infer E` 才是
 * InferTypeNode）⇒ 只认 InferTypeNode 会把「真支就是 infer 变量」误判成
 * 「真支是别的东西」⇒ 未决路径退化成两支并集、`relation.inferFrom` 丢失
 * （D3 infer 端到端红）。
 *
 * 真支是**嵌套条件类型**时必须判 false ⇒ 走「递归求值 + 两支并集」
 * （Bug 823：真支被 infer 变量顶替 ⇒ 返回与 TS 相反的确切字面量）。
 */
function trueBranchIsInferVar(
  node: ts.ConditionalTypeNode,
  condMeta: { inferVar: string },
): boolean {
  const t = stripParens(node.trueType);
  if (ts.isInferTypeNode(t)) return t.typeParameter.name.text === condMeta.inferVar;
  if (ts.isTypeReferenceNode(t) && !(t.typeArguments && t.typeArguments.length > 0)) {
    return typeNameString(t.typeName) === condMeta.inferVar;
  }
  return false;
}

type CondMeta = { fromVar: string; via: "arr" | "promise"; inferVar: string; fallback: Abs };

/** 识别 `T extends (infer E)[]` / `T extends Promise<infer U>` 形态 */
function analyzeCondPattern(
  _ctx: HarvestContext,
  node: ts.ConditionalTypeNode,
  check: Abs,
): { fromVar: string; via: "arr" | "promise"; inferVar: string } | undefined {
  if (check.term?.op !== "var") return undefined;
  const fromVar = check.term.id;
  const ext = stripParens(node.extendsType); // 括号穿透（Bug 798）
  const names = collectInferNames(ext);
  const inferVar = [...names][0];
  if (!inferVar) return undefined;
  if (ts.isArrayTypeNode(ext)) {
    return { fromVar, via: "arr", inferVar };
  }
  if (ts.isTypeReferenceNode(ext)) {
    const n = typeNameString(ext.typeName);
    if (n === "Promise" || n === "PromiseLike") return { fromVar, via: "promise", inferVar };
    if (n === "Array" || n === "ReadonlyArray" || n === "List" || n === "ArrayLike") {
      return { fromVar, via: "arr", inferVar };
    }
  }
  return undefined;
}

function mapType(
  ctx: HarvestContext,
  node: ts.TypeNode | undefined,
  depth: number,
  bindings?: Map<string, Abs>,
): Abs {
  if (!node || depth > MAX_ALIAS_DEPTH) return absUnknown();

  if (ts.isParenthesizedTypeNode(node)) return mapType(ctx, node.type, depth, bindings);
  if (ts.isTypeReferenceNode(node)) return mapTypeRef(ctx, node, depth, bindings);

  if (ts.isArrayTypeNode(node)) return absArr(mapType(ctx, node.elementType, depth, bindings));
  if (ts.isTupleTypeNode(node)) {
    // Bug 802：元组按**逐槽**映射（此前只取首元素 ⇒ 槽位 ≥1 的元素域是
    // **错的具体类型**：`[number, string]` 与 `[number, boolean]` 收割成
    // 完全相同的 `number[]`）。
    const elements: Abs[] = [];
    let rest: Abs | undefined;
    for (const element of node.elements) {
      if (ts.isNamedTupleMember(element)) {
        let t = mapType(ctx, element.type, depth, bindings);
        if (element.questionToken) t = absUnion([t, absUndefLit()]);
        elements.push(t);
        continue;
      }
      if (ts.isOptionalTypeNode(element)) {
        elements.push(absUnion([mapType(ctx, element.type, depth, bindings), absUndefLit()]));
        continue;
      }
      if (ts.isRestTypeNode(element)) {
        rest = mapType(ctx, element.type, depth, bindings);
        continue;
      }
      elements.push(mapType(ctx, element, depth, bindings));
    }
    return makeAbs(
      { k: "tuple", elements, ...(rest ? { rest } : {}) },
      undefined,
      undefined,
      "exact",
    );
  }

  if (ts.isUnionTypeNode(node)) {
    const members = node.types.map((t) => mapType(ctx, t, depth, bindings));
    // 字面量并集（null | undefined）保留 sum：joinAbs 会塌成 unknown，
    // 导致 `number extends null|undefined` 误判为 true。
    const hasLit = members.some((m) => m.term?.op === "lit");
    if (hasLit && members.length > 1) {
      return absExact({ k: "sum", members });
    }
    return absUnion(members);
  }

  if (ts.isIntersectionTypeNode(node)) {
    const members = node.types.map((t) => mapType(ctx, t, depth, bindings));
    // Bug 799：交叉类型要**合并成员**（此前只保留 A ⇒ `Point & Size` 与
    // `Point` 在 Abs 层面完全不可区分；接口引用经 instanceFor 产出的是
    // brand 形状，旧的「全是 obj」守卫直接失败）。
    const merged = mergeIntersection(members);
    if (merged) return merged;
    return members[0] ?? absUnknown();
  }

  if (ts.isLiteralTypeNode(node)) {
    const lit = node.literal;
    if (ts.isStringLiteral(lit)) return absLit(lit.text);
    if (ts.isNumericLiteral(lit)) return absLit(Number(lit.text));
    if (lit.kind === ts.SyntaxKind.TrueKeyword) return absLit(true);
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return absLit(false);
    if (lit.kind === ts.SyntaxKind.NullKeyword) return absNullLit();
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
    // 类型字面量：构造签名 / 调用签名 / 索引签名 / 普通成员
    const ctor = node.members.find(ts.isConstructSignatureDeclaration);
    if (ctor) {
      // Bug 829：构造签名 ⇒ **可构造**面（ctor facet）+ 构造形参
      // （此前投影成普通可调用 fn ⇒ `new C(1)` 假红 may-throw，
      //   且 `C(1)` 假绿：TS 明确 TS2348 不可调用）。
      const params: Abs[] = [];
      for (const param of ctor.parameters) {
        let type = param.type ? mapType(ctx, param.type, depth, bindings) : absUnknown();
        if (param.questionToken) type = absUnion([type, absUndefLit()]);
        params.push(type);
      }
      const instance = ctor.type ? mapType(ctx, ctor.type, depth, bindings) : absUnknown();
      // 构造签名的「返回面」= 实例类型：条件元数据在此**被消费**
      // （Bug 821：不消费 ⇒ 残留在上下文级单槽 ⇒ 被下一条签名捡走）。
      const cond = takePendingCond(ctx);
      // 与构造签名共存的具名成员不丢（静态槽）
      const { properties } = mapTypeMembers(ctx, node.members, depth, bindings);
      return attachFnSlots(absCtorSig(params, instance, condExtra(cond)), properties);
    }
    const call = node.members.find(ts.isCallSignatureDeclaration);
    if (call) {
      // Bug 830：调用签名 ⇒ fn 面（此前**整条跳过** ⇒ 该值被折成空对象
      // ⇒ 调用即 TypeError ⇒ L2 假红）。
      const params: Abs[] = [];
      for (const param of call.parameters) {
        let type = param.type ? mapType(ctx, param.type, depth, bindings) : absUnknown();
        if (param.questionToken) type = absUnion([type, absUndefLit()]);
        params.push(type);
      }
      const ret = call.type ? mapType(ctx, call.type, depth, bindings) : absUnknown();
      // 调用签名的返回面：条件元数据在此**被消费**（Bug 821：不消费 ⇒
      // 残留在上下文级单槽 ⇒ 被下一条签名捡走）。
      const cond = takePendingCond(ctx);
      // 与调用签名共存的具名成员不丢（静态槽）
      const { properties } = mapTypeMembers(ctx, node.members, depth, bindings);
      return attachFnSlots(absFnSig(params, ret, condExtra(cond)), properties);
    }
    const { properties, index } = mapTypeMembers(ctx, node.members, depth, bindings);
    if (index) return absOpenObj(properties, index); // Bug 803：索引签名 → 开放对象
    return absObj(properties);
  }

  if (ts.isTypeOperatorNode(node)) {
    if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return mapType(ctx, node.type, depth, bindings);
    }
    if (node.operator === ts.SyntaxKind.KeyOfKeyword) {
      // `keyof T` → 键名并集（可算时）；判不出 ⇒ 退化哨兵（extends 位
      // 按「判不出」处理，不恒真 —— Bug 822）。
      const names = keyofNamesOf(ctx, node.type, depth);
      if (!names) return absUnknown();
      if (names.length === 0) return absNever();
      return absExact({ k: "sum", members: names.map((n) => absLit(n)) });
    }
    return absUnknown();
  }

  if (ts.isConditionalTypeNode(node)) {
    return mapConditionalType(ctx, node, depth, bindings);
  }

  if (ts.isInferTypeNode(node)) {
    // 裸 infer U：外层条件类型绑定过 ⇒ 取绑定值；未绑定 ⇒ α 变量
    const name = node.typeParameter.name.text;
    const bound = bindings?.get(name);
    if (bound) return bound;
    return typeVarAbs(name);
  }

  if (ts.isTypePredicateNode(node)) {
    // Bug 1054：TS 类型谓词（`x is T` / `asserts x is T`）的**返回类型**是
    // `boolean` / `void` —— 被谓词的 `T` 是**收窄信息**（调用点的副作用），
    // **不是**返回面。此前本函数没有 `TypePredicate` 分支 ⇒ 落到兜底
    // ⇒ 收割成 `unknown` ⇒ 调用方签名面变 `unknown` ⇒ 触发
    // `nudo:unknown-inference` 误导诊断（把「谓词返回 boolean」说成
    // 「推断失败」）+ dts 面写 `unknown` ⇒ 消费方 tsc TS2322 假红。
    // `asserts` 断言函数（`asserts x is T` / `asserts x`）运行时返回
    // `undefined` ⇒ 与 `: void` 同口径（同 `mapType` 的 VoidKeyword 分支）。
    return node.assertsModifier ? absUndefLit() : absPrim("boolean");
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
  // `__proto__` 必须用计算属性名：对象字面量里的 `__proto__: v`（即便写成
  // "__proto__" 带引号）也会触发 [[SetPrototypeOf]] ⇒ 该成员从字面量里消失，
  // 字面量的原型还被改成 v（Bug 836 的落盘面）。
  // 计算属性名走 CreateDataProperty ⇒ 只是普通自有键。
  if (key === "__proto__") return `["__proto__"]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function emitEntries(lines: string[], record: Record<string, Abs>, level: number): void {
  // Object.entries 只列自有可枚举键 ⇒ 原型链上的成员不会被当成收割到的导出
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
      // 族 27 Bug 811：泛型 α 的 var term 落盘时整体丢失 ⇒ 落盘 env 模块
      // **失去泛型性**（内存面 `(arr(T)) => T`，产物面 `unknown`）。
      // `case "any"` 是 α 未被代入时的落点 ⇒ 这里要把 var term 保住。
      if (a.term?.op === "var") {
        return `makeAbs({ k: "any" }, termVar(${JSON.stringify(a.term.id)}), undefined, "path")`;
      }
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
      // bigint / symbol：内存面（mapType → absPrim）保留为 prim 原语，落盘面
      // 必须同口径——否则「同一份 .d.ts，内存收割与落盘产物给出不同答案」
      // （Bug 795）。磁盘投影（harvest-json.ts）本来就带这两个 prim 类型。
      if (s.type === "bigint") {
        return `makeAbs({ k: "prim", type: "bigint" }, undefined, undefined, "exact")`;
      }
      if (s.type === "symbol") {
        return `makeAbs({ k: "prim", type: "symbol" }, undefined, undefined, "exact")`;
      }
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
      // 族 27 Bug 826 / 830 的**落盘面**：ctor facet 与静态槽必须一起落盘，
      // 否则「同一份 .d.ts，内存收割面 / 磁盘缓存面 / 落盘源码面」三路径
      // 给出的不是同一个类型（落盘面丢 facet ⇒ `new X()` 落「可构造性未知」
      // ⇒ may-throw 假红；丢静态槽 ⇒ 类型字面量的具名成员消失）。
      // 用 IIFE 表达「relationFn 之后再补 facet」——不改 core 冻结面。
      const facets: string[] = [];
      if (s.ctor !== undefined) facets.push(`f.shape.ctor = ${s.ctor ? "true" : "false"};`);
      const slotEntries = Object.entries(s.slots ?? {});
      if (slotEntries.length > 0) {
        const entries = slotEntries
          .map(([key, slot]) => `${emitKey(key)}: { value: ${emitAbs(slot.value, expanding)} }`)
          .join(", ");
        facets.push(`f.shape.slots = { ${entries} };`);
      }
      if (facets.length === 0) return `relationFn([${params}], ${ret}, { conf: "exact" })`;
      return `(() => { const f = relationFn([${params}], ${ret}, { conf: "exact" }); ${facets.join(" ")} return f; })()`;
    }
    default:
      return "absUnknown";
  }
}

