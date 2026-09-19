/**
 * 源码级调用图侦察：从 check 门禁拆出的 AST 扫描层。
 *
 * 职责：不做代数求值结论，只回答「谁在调用谁、实参长什么样」——
 * - listTopFunctions：顶层函数清单
 * - collectCallResolvers / resolveCalleeFn / collectForwarders：别名 / 对象属性 /
 *   require / 动态 import / 无条件转发 的调用解析
 * - scanLiteralCalls：字面量调用点实参 vs 前置约束的违例收集
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import { emptyEnv, evalNode, evalProgramAbs } from "./ast-eval.ts";
import { defaultLeakBudget } from "./leak.ts";
import type { RefineEntry } from "./refine.ts";
import {
  instantiateConstraint,
  isIntFlag,
  type NudoConstraint,
  type NudoField,
} from "./constraint.ts";
import {
  effectiveInterface,
  formatConstraint,
  type EffectiveInterface,
  type EffectiveInterfaceOpts,
} from "./interface.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { resolveDepPath } from "./load-deps-fp.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import { locateContractParam, type FormalParam } from "./param-surface.ts";
import { numLit, litValue } from "./abs.ts";
import type { Abs } from "./abs.ts";
import { hashSource } from "./hash-source.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { formatAbs, formatShape } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import { getFnImpl } from "./abs-fn.ts";
import { getSlot } from "./objects.ts";

/**
 * HOF 实参是否满足目标 fn 形状。
 * 自定义放宽比较：JS 允许多余实参（src.params.length >= tgt.params.length）。
 * 不直接喂 leqAbs（arity 严格相等对 JS 太严）。
 */
function hofFnArgOk(src: Abs, tgt: Abs): boolean {
  if (src.shape.k !== "fn") return false;
  const t = tgt.shape;
  if (t.k !== "fn") return false;
  // arity：JS 允许多余实参
  if (src.shape.params.length < t.params.length) return false;
  // 有 returnType 槽时不要求 src 也有（弱信息可接受）
  return true;
}

/** 顶层函数清单：function 声明 + const 箭头/函数表达式（含 export 包装）
 *  + **导出 class 的实例方法**（C4.2，命名 `Class.method`）。
 *  P1：本地 `class Foo` 经 `export { Foo }` / `export { Foo as default }` /
 *  `export default Foo` 导出时同样登记实例方法。 */
export function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
  const f = file ?? parse(source);
  const names: string[] = [];
  /** 本地 ClassDeclaration（含未直接 export 的） */
  const localClasses = new Map<string, Node>();
  for (const stmt of f.program.body) {
    if (stmt.type === "ClassDeclaration") {
      const cname = (stmt as { id?: { name?: string } }).id?.name;
      if (cname) localClasses.set(cname, stmt);
    }
  }
  /** 经任意 export 形态暴露的 class 本地名 */
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: Node) => {
    const body = (decl as { body?: { body?: unknown[] } }).body?.body ?? [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        key?: { type?: string; name?: string };
        static?: boolean;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod) continue;
      if (mem.kind && mem.kind !== "method") continue; // skip ctor/get/set
      if (mem.static) continue;
      const keyName =
        mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (keyName) names.push(`${cname}.${keyName}`);
    }
  };
  for (const stmt of f.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (decl.type === "FunctionDeclaration" && decl.id) names.push(decl.id.name);
    if (
      decl.type === "FunctionDeclaration" &&
      !decl.id &&
      stmt.type === "ExportDefaultDeclaration"
    ) {
      if (!names.includes("default")) names.push("default");
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
    // C4.2：导出 class 的普通实例方法 → `Class.method`（跳过 ctor/get/set）
    if (
      decl.type === "ClassDeclaration" &&
      (decl as { id?: { name?: string } }).id?.name &&
      (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration")
    ) {
      const cname = (decl as { id: { name: string } }).id.name;
      exportedClassNames.add(cname);
      collectClassMethods(cname, decl);
    }
  }
  // P1：export { Foo } / export { Foo as default } / export default Foo
  for (const stmt of f.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      const specs = (stmt as { specifiers?: unknown[] }).specifiers ?? [];
      for (const spec of specs) {
        const s = spec as {
          type?: string;
          local?: { name?: string };
          exported?: { name?: string; value?: unknown };
        };
        if (s.type !== "ExportSpecifier") continue;
        const localName = s.local?.name;
        if (!localName || exportedClassNames.has(localName)) continue;
        const exportedName = s.exported?.name ?? s.exported?.value;
        const isDefault = exportedName === "default";
        // 只在「导出到外部」时登记：export { Foo } 或 export { Foo as default }
        if (!isDefault && exportedName !== localName) {
          // export { Foo as Bar }：仍导出 class，方法键按本地名
        }
        const decl = localClasses.get(localName);
        if (!decl) continue;
        exportedClassNames.add(localName);
        collectClassMethods(localName, decl);
      }
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      const d = stmt.declaration;
      if (d.type === "Identifier") {
        const localName = d.name;
        if (!exportedClassNames.has(localName)) {
          const decl = localClasses.get(localName);
          if (decl) {
            exportedClassNames.add(localName);
            collectClassMethods(localName, decl);
          }
        }
      }
    }
  }
  // CJS：exports.f = fn / module.exports.f = fn / module.exports = { f: fn }
  for (const stmt of f.program.body) {
    if (stmt.type !== "ExpressionStatement") continue;
    const expr = (stmt as { expression?: unknown }).expression as
      | { type?: string; left?: unknown; right?: unknown }
      | undefined;
    if (!expr || expr.type !== "AssignmentExpression") continue;
    const left = expr.left as {
      type?: string;
      object?: { type?: string; name?: string; object?: { name?: string }; property?: { name?: string } };
      property?: { type?: string; name?: string; value?: unknown };
      computed?: boolean;
    } | undefined;
    const right = expr.right;
    if (!left || left.type !== "MemberExpression" || left.computed) continue;
    const obj = left.object;
    const prop = left.property;
    const propName =
      prop?.type === "Identifier"
        ? prop.name
        : prop?.type === "StringLiteral" || prop?.type === "NumericLiteral"
          ? String(prop.value)
          : undefined;
    const isExportsIdent = !!obj && obj.type === "Identifier" && obj.name === "exports";
    const isModuleExportsMember =
      !!obj &&
      obj.type === "MemberExpression" &&
      obj.object?.name === "module" &&
      obj.property?.name === "exports";
    const isModuleExportsIdent =
      !!obj && obj.type === "Identifier" && obj.name === "module" && propName === "exports";

    const pushFnFromInit = (fallbackName: string | undefined, init: unknown): void => {
      const r = init as { type?: string; id?: { name?: string } } | undefined;
      if (!r) return;
      if (r.type !== "FunctionExpression" && r.type !== "ArrowFunctionExpression") return;
      const n = r.id?.name ?? fallbackName;
      if (n && !names.includes(n)) names.push(n);
    };

    if (isModuleExportsIdent) {
      pushFnFromInit(undefined, right);
      const objLit = right as { type?: string; properties?: unknown[] } | undefined;
      if (objLit?.type === "ObjectExpression") {
        for (const p of objLit.properties ?? []) {
          const prop2 = p as {
            type?: string;
            key?: { type?: string; name?: string; value?: unknown };
            value?: unknown;
          };
          if (prop2.type !== "ObjectProperty" && prop2.type !== "Property") continue;
          const keyName =
            prop2.key?.type === "Identifier"
              ? prop2.key.name
              : prop2.key?.type === "StringLiteral" || prop2.key?.type === "NumericLiteral"
                ? String(prop2.key.value)
                : undefined;
          if (keyName) pushFnFromInit(keyName, prop2.value);
        }
      }
      continue;
    }
    if ((isExportsIdent || isModuleExportsMember) && propName) {
      pushFnFromInit(propName, right);
    }
  }
  return names;
}

export function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/** 静态求值实参节点 → Abs（标识符走绑定表；对象/数组字面量内的标识符也走绑定表） */
function evalArgAbs(
  node: Record<string, unknown>,
  lookupVar?: (name: string) => Abs | undefined,
): Abs | undefined {
  if (node.type === "Identifier" && typeof node.name === "string" && lookupVar) {
    return lookupVar(node.name);
  }
  try {
    const env = emptyEnv();
    // 把文件级绑定表灌进 env，使 `{...base}` / `[x]` 等复合实参能解析标识符
    if (lookupVar) {
      // lookupVar 只支持按名查；用 Proxy 包一层 vars 不可行——改为在
      // evalNode 前手工预绑定已知名。scanLiteralCalls 的 varAbs 通常很小。
      // 这里通过包装 env.vars 的 get 实现按需注入。
      const rawGet = env.vars.get.bind(env.vars);
      env.vars.get = ((name: string) => {
        const hit = rawGet(name);
        if (hit !== undefined) return hit;
        return lookupVar(name);
      }) as typeof env.vars.get;
    }
    return evalNode(node as unknown as Node, env, pTrue, defaultLeakBudget).value;
  } catch {
    return undefined;
  }
}

/** 外部模块函数：源码 + 导出名 + 定义文件虚拟路径（interface 侧车解析基；不可得 → 省略） */
type ExternalFnRef = { source: string; fnName: string; fromFile?: string };

/** 扫描前收集：别名 / 对象属性 / require 导入 */
type CallResolve = {
  /** 本地名 → 真实函数名（同文件） */
  aliasToFn: Map<string, string>;
  /** 对象名.属性名 → 真实函数名（同文件） */
  memberToFn: Map<string, string>;
  /** 本地名 → 外部模块函数（源码 + 导出名 + 定义文件路径） */
  externalFn: Map<string, ExternalFnRef>;
  /** 对象名.属性名 → 外部模块函数 */
  externalMember: Map<string, ExternalFnRef>;
};

function requireSpecOf(init: Record<string, unknown>): string | undefined {
  // require('./x')
  if (init.type === "CallExpression") {
    const callee = init.callee as { type?: string; name?: string } | undefined;
    const args = init.arguments as Array<{ type?: string; value?: unknown }> | undefined;
    if (
      callee?.type === "Identifier" &&
      callee.name === "require" &&
      args?.[0]?.type === "StringLiteral"
    ) {
      return String(args[0].value);
    }
  }
  // require('./x').fn
  if (init.type === "MemberExpression") {
    const obj = init.object as Record<string, unknown> | undefined;
    if (obj) return requireSpecOf(obj);
  }
  return undefined;
}

function requireExportName(init: Record<string, unknown>): string | undefined {
  // require('./x').fn
  if (init.type === "MemberExpression" && !init.computed) {
    const prop = init.property as { type?: string; name?: string } | undefined;
    if (prop?.type === "Identifier") return prop.name;
  }
  return undefined;
}

/** `await import('./m')` / `import('./m')` → spec */
function dynamicImportSpec(node: Record<string, unknown>): string | undefined {
  let n: Record<string, unknown> | undefined = node;
  if (n?.type === "AwaitExpression") {
    n = n.argument as Record<string, unknown> | undefined;
  }
  if (!n) return undefined;
  // Babel 8：ImportExpression { source: StringLiteral }
  if (n.type === "ImportExpression") {
    const src = n.source as { type?: string; value?: unknown } | undefined;
    if (src?.type === "StringLiteral" && typeof src.value === "string") return String(src.value);
    return undefined;
  }
  // Babel 7 / legacy：CallExpression + callee.type === "Import"
  if (n.type !== "CallExpression") return undefined;
  const callee = n.callee as { type?: string } | undefined;
  if (callee?.type !== "Import") return undefined;
  const args = n.arguments as Array<{ type?: string; value?: unknown }> | undefined;
  if (args?.[0]?.type === "StringLiteral") return String(args[0].value);
  return undefined;
}

/**
 * 模块源码里找不到 fnName 时，沿 `export { fn } from './other'` / `export * from` 一跳跟进。
 * 返回定义了该函数的源码及其虚拟路径——interface 侧车绑定按最终定义文件定位。
 * 跳转 spec 必须相对**当前中间模块**目录解析（不是原始调用方）：`a.js` →
 * `sub/b.js` → `./c.js` 的目标是 `sub/c.js`，不是与 `a.js` 同目录的 `c.js`。
 */
function resolveExportSource(
  modSrc: string,
  fnName: string,
  loadSpecFrom: (spec: string, fromFile: string) => string | undefined,
  depth = 0,
  baseFromFile = "",
  modFromFile = "",
): { source: string; fromFile: string } {
  const here = (): { source: string; fromFile: string } => ({
    source: modSrc,
    fromFile: modFromFile,
  });
  if (depth > 3) return here();
  try {
    if (listTopFunctions(modSrc).includes(fnName)) return here();
  } catch {
    return here();
  }
  const file = parse(modSrc);
  let nextSpec: string | undefined;
  for (const stmt of file.program.body) {
    if (stmt.type !== "ExportNamedDeclaration" && stmt.type !== "ExportAllDeclaration") continue;
    const src = (stmt as { source?: { type?: string; value?: unknown } }).source;
    if (src?.type !== "StringLiteral" || typeof src.value !== "string") continue;
    if (stmt.type === "ExportAllDeclaration") {
      nextSpec = String(src.value);
      break;
    }
    const clause = ((stmt as { specifiers?: unknown[] }).specifiers ?? []) as Array<Record<string, unknown>>;
    for (const sp of clause) {
      if (sp.type !== "ExportSpecifier") continue;
      const local = sp.local as { type?: string; name?: string } | undefined;
      if (local?.type === "Identifier" && local.name === fnName) {
        nextSpec = String(src.value);
        break;
      }
    }
    if (nextSpec) break;
  }
  if (!nextSpec) return here();
  // 中间模块路径是下一跳解析基；首跳用 modFromFile，再跳用上一跳解析结果
  const hopFrom = modFromFile || baseFromFile;
  const next = hopFrom ? loadSpecFrom(nextSpec, hopFrom) : undefined;
  if (!next) return here();
  const nextFromFile = hopFrom ? resolveDepPath(hopFrom, nextSpec) : "";
  return resolveExportSource(
    next,
    fnName,
    loadSpecFrom,
    depth + 1,
    baseFromFile,
    nextFromFile,
  );
}

/** 只递归可能含 Import/VariableDeclaration 的语句容器（resolvers/forwarders 用） */
const STMT_CONTAINER = new Set([
  "File",
  "Program",
  "BlockStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "SwitchCase",
  "TryStatement",
  "CatchClause",
  "LabeledStatement",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "ClassDeclaration",
  "ClassBody",
  "ClassMethod",
  "StaticBlock",
  "ObjectMethod",
]);

function walkStatements(n: unknown, onStmt: (obj: Record<string, unknown> & { type?: string }) => void): void {
  if (!n || typeof n !== "object") return;
  const obj = n as Record<string, unknown> & { type?: string };
  if (typeof obj.type === "string") onStmt(obj);
  if (!STMT_CONTAINER.has(String(obj.type))) return;
  for (const key of Object.keys(obj)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments") continue;
    const val = obj[key];
    if (Array.isArray(val)) val.forEach((x) => walkStatements(x, onStmt));
    else if (val && typeof val === "object") walkStatements(val, onStmt);
  }
}

function collectCallResolvers(
  source: string,
  knownFns: string[],
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
  },
): CallResolve {
  const knownSet = new Set(knownFns);
  const aliasToFn = new Map<string, string>();
  const memberToFn = new Map<string, string>();
  const externalFn = new Map<string, ExternalFnRef>();
  const externalMember = new Map<string, ExternalFnRef>();
  const file = opts?.file ?? parse(source);
  const load = opts?.loadModule;
  const fromFile = opts?.fromFile ?? "";
  const modCache = new Map<string, string | undefined>();
  /** 按 (spec, 解析基文件) 加载——re-export 跳转必须相对中间模块，不是原始调用方 */
  const loadSpecFrom = (spec: string, from: string): string | undefined => {
    if (!load) return undefined;
    const key = from + "\0" + spec;
    if (!modCache.has(key)) modCache.set(key, load(spec, from));
    return modCache.get(key);
  };
  /** import spec → 被引模块的虚拟路径（interface 侧车解析基；无 fromFile 时不可得） */
  const extFromFile = (spec: string): string | undefined =>
    fromFile ? resolveDepPath(fromFile, spec) : undefined;
  const bindExternal = (local: string, modSrc: string, fnName: string, spec: string): void => {
    const r = resolveExportSource(modSrc, fnName, loadSpecFrom, 0, fromFile, extFromFile(spec) ?? "");
    externalFn.set(local, {
      source: r.source,
      fnName,
      ...(r.fromFile ? { fromFile: r.fromFile } : {}),
    });
  };
  /** 首跳加载：相对当前调用方文件（与既有口径一致） */
  const loadSpec = (spec: string): string | undefined => loadSpecFrom(spec, fromFile);

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };

    // ESM：import { fn } / import { fn as x } / import * as ns from '...'
    if (obj.type === "ImportDeclaration") {
      const spec = obj.source as { type?: string; value?: unknown } | undefined;
      if (spec?.type === "StringLiteral" && typeof spec.value === "string") {
        const modSrc = loadSpec(String(spec.value));
        if (modSrc) {
          for (const sp of (obj.specifiers as Array<Record<string, unknown>> | undefined) ?? []) {
            if (sp.type === "ImportSpecifier") {
              const imported = sp.imported as { type?: string; name?: string; value?: unknown } | undefined;
              const local = sp.local as { type?: string; name?: string } | undefined;
              const exportName =
                imported?.type === "Identifier"
                  ? imported.name
                  : imported?.type === "StringLiteral"
                    ? String(imported.value)
                    : undefined;
              if (exportName && local?.name) {
                bindExternal(local.name, modSrc, exportName, String(spec.value));
              }
            } else if (sp.type === "ImportNamespaceSpecifier") {
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                const from = extFromFile(String(spec.value));
                externalMember.set(
                  `${local.name}.__module__`,
                  { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
                );
              }
            }
            // ImportDefaultSpecifier：默认导出名不定，暂不绑定
          }
        }
      }
    }

    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string; properties?: Array<Record<string, unknown>> };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (!id || !init) continue;

        // 动态 import：const m = await import('./x') / const { fn } = await import('./x')
        const dynSpec = dynamicImportSpec(init);
        if (dynSpec) {
          const modSrc = loadSpec(dynSpec);
          if (modSrc && id.type === "ObjectPattern") {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) bindExternal(local, modSrc, exported, dynSpec);
            }
          }
          if (modSrc && id.type === "Identifier" && id.name) {
            const from = extFromFile(dynSpec);
            externalMember.set(
              `${id.name}.__module__`,
              { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
            );
          }
        }

        // require 导入
        const spec = requireSpecOf(init);
        if (spec) {
          const modSrc = loadSpec(spec);
          // const { fn } = require(...)
          if (id.type === "ObjectPattern" && modSrc) {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) {
                bindExternal(local, modSrc, exported, spec);
              }
            }
          }
          // const m = require(...) → m.fn
          if (id.type === "Identifier" && id.name && modSrc) {
            const exportName = requireExportName(init);
            if (exportName) {
              bindExternal(id.name, modSrc, exportName, spec);
            } else {
              const from = extFromFile(spec);
              externalMember.set(
                `${id.name}.__module__`,
                { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
              );
            }
          }
        }

        if (id.type !== "Identifier" || !id.name) continue;
        // const f = needsPositive
        if (init.type === "Identifier" && typeof init.name === "string" && knownSet.has(init.name)) {
          aliasToFn.set(id.name, init.name);
        }
        // const api = { needsPositive }
        if (init.type === "ObjectExpression") {
          for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key as { type?: string; name?: string; value?: unknown };
            const value = p.value as { type?: string; name?: string } | undefined;
            if (value?.type === "Identifier" && value.name && knownSet.has(value.name)) {
              const propKey =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              if (propKey) memberToFn.set(`${id.name}.${propKey}`, value.name);
            }
          }
        }
      }
    }
  };
  // 语句容器 walk：不进表达式树，O(语句) 而非 O(全部节点)
  walkStatements(file, visit);
  return { aliasToFn, memberToFn, externalFn, externalMember };
}

/** 解析 callee → 同文件名或外部模块描述 */
function resolveCalleeFn(
  callee: Record<string, unknown>,
  resolve: CallResolve,
  knownFns: Set<string>,
): string | { external: ExternalFnRef } | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    const ext = resolve.externalFn.get(callee.name);
    if (ext) return { external: ext };
    const aliased = resolve.aliasToFn.get(callee.name);
    if (aliased) return aliased;
    if (knownFns.has(callee.name)) return callee.name;
    return undefined;
  }
  if (callee.type === "MemberExpression") {
    const obj = callee.object as { type?: string; name?: string } | undefined;
    const prop = callee.property as { type?: string; name?: string } | undefined;
    if (
      !callee.computed &&
      obj?.type === "Identifier" &&
      obj.name &&
      prop?.type === "Identifier" &&
      prop.name
    ) {
      const key = `${obj.name}.${prop.name}`;
      const extM = resolve.externalMember.get(key);
      if (extM) return { external: extM };
      // m = require(...)；调用 m.fn
      const mod = resolve.externalMember.get(`${obj.name}.__module__`);
      if (mod?.source) {
        return {
          external: {
            source: mod.source,
            fnName: prop.name,
            ...(mod.fromFile ? { fromFile: mod.fromFile } : {}),
          },
        };
      }
      const local = resolve.memberToFn.get(key);
      if (local) return local;
    }
  }
  return undefined;
}

/**
 * 无条件转发：`function w(a,b){ return target(a,b); }`
 * 或箭头 `const w = (a) => target(a)`。
 * map[i] = wrapper 第 i 参 → target 的第几参。
 */
type Forward = { target: string; map: number[] };

function collectForwarders(
  source: string,
  knownFns: Set<string>,
  resolve: CallResolve,
  fileAst?: ReturnType<typeof parse>,
): Map<string, Forward> {
  const forwards = new Map<string, Forward>();
  const file = fileAst ?? parse(source);

  const tryFn = (
    name: string,
    params: Array<{ type?: string; name?: string }>,
    body: Record<string, unknown> | undefined,
  ): void => {
    if (!name || !params.length) return;
    const paramNames = params.map((p) => (p?.type === "Identifier" ? p.name : undefined));
    if (paramNames.some((n) => !n)) return;

    // body: BlockStatement 仅一条 ReturnStatement(CallExpression)
    //      或箭头表达式体 CallExpression
    let call: Record<string, unknown> | undefined;
    if (body?.type === "BlockStatement") {
      const stmts = (body.body as Array<Record<string, unknown>> | undefined) ?? [];
      if (stmts.length !== 1 || stmts[0]!.type !== "ReturnStatement") return;
      const arg = stmts[0]!.argument as Record<string, unknown> | undefined;
      if (arg?.type !== "CallExpression") return;
      call = arg;
    } else if (body?.type === "CallExpression") {
      call = body;
    }
    if (!call) return;

    const resolved = resolveCalleeFn(call.callee as Record<string, unknown>, resolve, knownFns);
    if (!resolved || typeof resolved !== "string") return;
    if (!knownFns.has(resolved) || resolved === name) return;

    const args = (call.arguments as Array<Record<string, unknown>> | undefined) ?? [];
    if (args.length === 0) return;
    // 每个实参必须是 wrapper 自己的参数标识符
    const map: number[] = [];
    for (const a of args) {
      if (a.type !== "Identifier" || typeof a.name !== "string") return;
      const idx = paramNames.indexOf(a.name);
      if (idx < 0) return;
      map.push(idx);
    }
    forwards.set(name, { target: resolved, map });
  };

  walkStatements(file, (obj) => {
    if (obj.type === "FunctionDeclaration") {
      const id = obj.id as { name?: string } | undefined;
      tryFn(
        id?.name ?? "",
        (obj.params as Array<{ type?: string; name?: string }>) ?? [],
        obj.body as Record<string, unknown>,
      );
    }
    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (
          id?.type === "Identifier" &&
          id.name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          tryFn(
            id.name,
            (init.params as Array<{ type?: string; name?: string }>) ?? [],
            init.body as Record<string, unknown>,
          );
        }
      }
    }
  });
  return forwards;
}

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)` / require 导入，检查约束 */
export function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** 顶层绑定表（与结构赋值共享的 evalProgramAbs 结果） */
    varAbs?: Map<string, Abs>;
    /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
    autoBind?: boolean;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = opts?.file ?? parse(source);
  const knownSet = new Set(knownFns);
  const resolve = collectCallResolvers(source, knownFns, opts);
  const forwards = collectForwarders(source, knownSet, resolve, file);
  const varAbs = opts?.varAbs ?? new Map<string, Abs>();

  const flattenPred = (p: Pred): Pred[] =>
    p.op === "and" ? p.args.flatMap(flattenPred) : p.op === "true" ? [] : [p];

  /**
   * effectiveInterface（§11 唯一读取口）调用侧收口：
   * - 同次扫描内按 (fn, fromFile, autoBind) 缓存——localNamedExports 走
   *   errorRecovery 解析不进 parse LRU，逐调用点重解析会放大开销。
   * - §3.3 执法分档：只有 handwritten 契约执法；generated 段是事实快照
   *   （drift 由后续检查报），implicit 无契约。
   */
  const eiCache = new Map<string, EffectiveInterface | undefined>();
  const effectiveInterfaceOf = (
    fnName: string,
    fnSource: string,
    eiOpts: EffectiveInterfaceOpts,
  ): EffectiveInterface | undefined => {
    // 等长不同内容不得串缓存（跨文件 checkExternalCall 场景）
    const key = `${fnName}\u0000${eiOpts.fromFile ?? ""}\u0000${eiOpts.autoBind === false ? "0" : "1"}\u0000${hashSource(fnSource)}`;
    if (eiCache.has(key)) return eiCache.get(key);
    const r = effectiveInterface(fnSource, fnName, eiOpts);
    eiCache.set(key, r);
    return r;
  };

  /** 解构/默认参契约名 → 实参字段投影（C4.1） */
  const projectArgField = (arg: Abs, field: string): Abs | undefined => {
    if (!arg) return undefined;
    if (arg.shape.k === "brand") {
      return projectArgField(arg.shape.shape as Abs, field);
    }
    if (arg.shape.k !== "obj") return undefined;
    return getSlot(arg.shape.slots, field)?.value;
  };

  /** effectiveInterface → [paramIdx, RefineEntry, field?]（C4.1：解构契约带 field 投影）
   *  conflict 位跳过：契约本身不可满足时调用点不该被当成违例（§2.1 / interface.ts conflict 注释） */
  const interfaceToIndexed = (
    ei: EffectiveInterface,
    paramNames: string[],
    formals?: FormalParam[],
  ): Array<[number, RefineEntry, string | undefined]> => {
    const conflict = new Set(ei.conflict?.params ?? []);
    const entries: Array<[number, RefineEntry, string | undefined]> = [];
    for (const { param, constraint } of ei.params) {
      if (!param || conflict.has(param)) continue;
      const idx = paramNames.indexOf(param);
      if (idx >= 0) {
        entries.push([
          idx,
          { param, pred: instantiateConstraint(constraint, param), constraint },
          undefined,
        ]);
        continue;
      }
      // C4.1：契约名不在求值展示名里 → formals / locateContractParam
      // （解构顶层绑定名、默认参名、rest 裸名）
      if (formals && formals.length > 0) {
        const hit = locateContractParam(formals, param);
        if (hit) {
          entries.push([
            hit.index,
            { param, pred: instantiateConstraint(constraint, param), constraint },
            hit.field,
          ]);
        }
      }
    }
    return entries;
  };

  // nudo:interface-conflict 只在 check.ts fn 级报告（权威面）：conflict 必然
  // 蕴含源文件含 @nudo:refine/@nudo:interface，fn 级门恒开且必然已报——
  // 调用点级再报一次只会双报两种消息形态（此处历史上曾重复，已收口）。

  /** eq(var, lit) / eq(lit, var) 的标量字面量端；非该形态 → undefined */
  const predEqLiteral = (p: Pred): number | string | boolean | undefined => {
    if (p.op !== "eq") return undefined;
    const v =
      p.a.op === "var" && p.b.op === "lit"
        ? p.b.value
        : p.b.op === "var" && p.a.op === "lit"
          ? p.a.value
          : undefined;
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      ? v
      : undefined;
  };

  /**
   * 字面量可判定的原子谓词 → true/false；不可判定（非字面量端 / 非
   * number 值上的数值界）→ undefined。or 分支聚合用：任一 true 即过，
   * 全可判定且全 false 才报，含 undefined 不猜。
   */
  const judgeLiteralPred = (
    p: Pred,
    lv: number | string | boolean,
    strLen: number | undefined,
  ): boolean | undefined => {
    if (p.op === "eq") {
      const v = predEqLiteral(p);
      return v === undefined ? undefined : lv === v;
    }
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") {
      return undefined;
    }
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
    const n = p.b.value;
    if (p.a.op === "app" && p.a.fn === "length") {
      if (strLen === undefined) return undefined;
      if (p.op === "gt") return strLen > n;
      if (p.op === "ge") return strLen >= n;
      if (p.op === "lt") return strLen < n;
      return strLen <= n;
    }
    if (typeof lv !== "number") return undefined;
    if (p.op === "gt") return lv > n;
    if (p.op === "ge") return lv >= n;
    if (p.op === "lt") return lv < n;
    return lv <= n;
  };

  const checkReqs = (
    displayName: string,
    reqs: Array<[number, import("./pred.ts").Pred, string | undefined, string | undefined]>,
    paramNames: string[],
    absArgs: Abs[],
    /** target 参下标 → 实参下标；缺省恒等 */
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, pred, field, contractParam] of reqs) {
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      let arg = absArgs[argIdx];
      if (!arg) continue;
      // C4.1：解构契约展示名优先用契约面（x），不回落到求值占位 _p0
      const paramName = contractParam || paramNames[idx] || `arg${idx}`;
      // C4.1：解构契约字段投影后再判 pred；缺字段不能静默跳过（FN）
      if (field) {
        const projected = projectArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          // unknown/any 无法证明缺字段；其余已知形态（含 obj 缺槽）→ 违例
          if (k !== "unknown" && k !== "any") {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `补全字段 ${field}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        arg = projected;
      }
      const lv = litValue(arg);
      const isStr = arg.shape.k === "prim" && (arg.shape as { type: string }).type === "string";
      const strLen = typeof lv === "string" ? lv.length : undefined;
      for (const p of flattenPred(pred)) {
        // typeof 约束（string() / number() / boolean() 裸 prim）
        // 只检查挂在参数自身上的 typeof；字段访问（u.name）交给 shape 路径
        if (p.op === "typeof") {
          if (p.t.op !== "var") continue;
          const expected = p.type;
          const actualPrim =
            arg.shape.k === "prim"
              ? (arg.shape as { type: string }).type
              : arg.shape.k === "obj" || arg.shape.k === "arr" || arg.shape.k === "tuple"
                ? "object"
                : arg.shape.k === "fn"
                  ? "function"
                  : undefined;
          // 只在有确定 prim 信息且不匹配时拦截；unknown/any 不猜
          if (actualPrim !== undefined && actualPrim !== expected) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: `typeof ${paramName} = "${expected}"`,
              suggestion: `改用 ${expected} 类型的值，或放宽 ${paramName} 的 refine`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        if (lv === undefined) continue;
        // eq / or 域（lit()/union() 契约实例化出的 eq/or 原子）：此前两个
        // 消费分支都只认 typeof/gt/ge/lt/le，字面量/析取契约违例被静默
        // 跳过——写了等于没写。可判定才报（宁缺勿滥）。
        if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") {
          if (p.op === "eq") {
            const v = predEqLiteral(p);
            if (v !== undefined && lv !== v) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(arg),
                expected: predToString(p),
                suggestion: `改用满足 ${predToString(p)} 的值，或放宽 ${paramName} 的前置`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          if (p.op === "or") {
            let pass = false;
            let unknown = false;
            for (const q of p.args) {
              const r = judgeLiteralPred(q, lv, strLen);
              if (r === true) {
                pass = true;
                break;
              }
              if (r === undefined) unknown = true;
            }
            if (!pass && !unknown) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(arg),
                expected: predToString(p),
                suggestion: `改用满足 ${predToString(p)} 的值，或放宽 ${paramName} 的前置`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
        }
        if (
          (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
          p.b.op === "lit" &&
          typeof p.b.value === "number"
        ) {
          const n = p.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[p.op];
          // length(t) 形式（string().min/max）
          if (p.a.op === "app" && p.a.fn === "length" && strLen !== undefined) {
            let ok = true;
            if (p.op === "gt") ok = strLen > n;
            if (p.op === "ge") ok = strLen >= n;
            if (p.op === "lt") ok = strLen < n;
            if (p.op === "le") ok = strLen <= n;
            if (!ok) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(arg),
                expected: `length(${paramName}) ${opSym} ${n}`,
                suggestion: `改用满足长度 ${opSym} ${n} 的值，或放宽 ${paramName} 的前置`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // 普通数值界
          if (isStr || typeof lv !== "number") continue;
          let ok = true;
          if (p.op === "gt") ok = (lv as number) > n;
          if (p.op === "ge") ok = (lv as number) >= n;
          if (p.op === "lt") ok = (lv as number) < n;
          if (p.op === "le") ok = (lv as number) <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `改用满足 ${predToString(p)} 的值，或放宽 ${paramName} 的前置`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }
  };

  /**
   * shape 约束：实参 object Abs 的每个字段 ⊭ 嵌套约束。
   * 缺字段 / 类型不符 / 数值界违例 → nudo:constraint-violated。
   */
  const checkShapeAgainstAbs = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    absArg: Abs,
    path: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!constraint.fields) return;
    // unknown 实参：无信息，不猜
    if (absArg.shape.k === "unknown" && !absArg.term) return;

    const slots =
      absArg.shape.k === "obj"
        ? (absArg.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots
        : undefined;

    if (!slots) {
      // 有形状信息但不是 object
      if (absArg.shape.k !== "unknown" && absArg.shape.k !== "never") {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(absArg),
          expected: `object shape at ${path}`,
          suggestion: `改用满足 ${path} 形状约束的 object`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
      return;
    }

    for (const [key, field] of Object.entries(constraint.fields) as Array<
      [string, NudoField]
    >) {
      const slot = getSlot(slots, key);
      const fieldPath = path === paramName ? `${paramName}.${key}` : `${path}.${key}`;
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(absArg),
            expected: `missing field ${fieldPath}`,
            suggestion: `补全字段 ${fieldPath}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      checkFieldConstraint(displayName, paramName, field.constraint, slot.value, fieldPath, loc);
    }
  };

  /** 单字段：prim 类型 + 数值界 + 嵌套 shape + array 元素 + int + 长度 */
  const checkFieldConstraint = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    fieldAbs: Abs,
    fieldPath: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (fieldAbs.shape.k === "unknown" && !fieldAbs.term) return;

    // prim 类型
    if (constraint.prim && fieldAbs.shape.k === "prim") {
      const actualPrim = (fieldAbs.shape as { type: string }).type;
      if (actualPrim !== constraint.prim) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(fieldAbs),
          expected: `typeof ${fieldPath} = "${constraint.prim}"`,
          suggestion: `把 ${fieldPath} 改成 ${constraint.prim}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
        return;
      }
    }

    // int：字面量必须是整数（builder 上 .int 是方法，标志须经 isIntFlag 读）
    if (isIntFlag(constraint)) {
      const iv = litValue(fieldAbs);
      if (typeof iv === "number" && !Number.isInteger(iv)) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(fieldAbs),
          expected: `${fieldPath} is int`,
          suggestion: `把 ${fieldPath} 改成整数`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }

    // 嵌套 shape
    if (constraint.fields) {
      checkShapeAgainstAbs(displayName, paramName, constraint, fieldAbs, fieldPath, loc);
    }

    // array 元素：逐元素检查
    if (constraint.element) {
      if (fieldAbs.shape.k === "arr") {
        checkFieldConstraint(
          displayName,
          paramName,
          constraint.element,
          (fieldAbs.shape as { element: Abs }).element,
          `${fieldPath}[]`,
          loc,
        );
      } else if (fieldAbs.shape.k === "tuple") {
        const els = (fieldAbs.shape as { elements: Abs[] }).elements;
        els.forEach((el, i) => {
          checkFieldConstraint(
            displayName,
            paramName,
            constraint.element!,
            el,
            `${fieldPath}[${i}]`,
            loc,
          );
        });
      }
    }

    // 数值界 + 长度界（preds 里可能含 length(t) 比较）
    const lv = litValue(fieldAbs);
    const sv = typeof lv === "string" ? lv.length : undefined;
    const isStr = fieldAbs.shape.k === "prim" && (fieldAbs.shape as { type: string }).type === "string";
    for (const p of constraint.preds) {
      const flat = p.op === "and" ? p.args : [p];
      for (const atom of flat) {
        if (
          (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
          atom.b.op === "lit" &&
          typeof atom.b.value === "number"
        ) {
          const n = atom.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
          // length(t) 形式
          if (atom.a.op === "app" && atom.a.fn === "length") {
            if (sv === undefined) continue;
            let ok = true;
            if (atom.op === "gt") ok = sv > n;
            if (atom.op === "ge") ok = sv >= n;
            if (atom.op === "lt") ok = sv < n;
            if (atom.op === "le") ok = sv <= n;
            if (!ok) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(fieldAbs),
                expected: `length(${fieldPath}) ${opSym} ${n}`,
                suggestion: `改用满足长度 ${opSym} ${n} 的 ${fieldPath}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // 普通数值界
          if (lv === undefined || typeof lv !== "number" || isStr) continue;
          let ok = true;
          if (atom.op === "gt") ok = lv > n;
          if (atom.op === "ge") ok = lv >= n;
          if (atom.op === "lt") ok = lv < n;
          if (atom.op === "le") ok = lv <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(fieldAbs),
              expected: `${fieldPath} ${opSym} ${n}`,
              suggestion: `改用满足 ${fieldPath} ${opSym} ${n} 的值，或放宽 ${paramName} 的前置`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }

    // eq / union 域（lit()/union() 字段契约）：bounds 分支判不了——域隶属
    // 判定（domain-membership 语义复用）；仅 eq/union 形态触发，防双报
    if (
      lv !== undefined &&
      (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") &&
      ((constraint.members?.length ?? 0) > 0 ||
        constraint.preds.some((p) => p.op === "eq")) &&
      !literalMeetsConstraint(lv, constraint)
    ) {
      out.push({
        severity: "error",
        code: "nudo:constraint-violated",
        message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
        actual: formatAbs(fieldAbs),
        expected: `${fieldPath} ∈ ${formatConstraint(constraint)}`,
        suggestion: `改用满足 ${formatConstraint(constraint)} 的 ${fieldPath}`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
    }
  };

  /** 对带 shape / array / int / prim 的 refine 做结构检查 */
  const checkShapeReqs = (
    displayName: string,
    reqs: Array<[number, RefineEntry, string | undefined]>,
    paramNames: string[],
    absArgs: Abs[],
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, entry, field] of reqs) {
      const c = entry.constraint;
      if (!c.fields && !c.element && !isIntFlag(c) && !c.prim) continue;
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      let arg = absArgs[argIdx];
      if (!arg) continue;
      const paramName = entry.param || paramNames[idx] || `arg${idx}`;
      // C4.1：解构契约 → 投影到字段再查；缺字段报 violation（与 checkReqs 同口径）
      if (field) {
        const projected = projectArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `补全字段 ${field}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        arg = projected;
      }
      // 裸 prim 已由 checkReqs 的 typeof pred 覆盖；此处只处理 shape/array/int
      // shape 字段
      if (c.fields) {
        checkShapeAgainstAbs(displayName, paramName, c, arg, paramName, loc);
      }
      // 顶层 array 元素
      if (c.element) {
        if (arg.shape.k === "arr") {
          checkFieldConstraint(
            displayName,
            paramName,
            c.element,
            (arg.shape as { element: Abs }).element,
            `${paramName}[]`,
            loc,
          );
        } else if (arg.shape.k === "tuple") {
          const els = (arg.shape as { elements: Abs[] }).elements;
          els.forEach((el, i) => {
            checkFieldConstraint(
              displayName,
              paramName,
              c.element!,
              el,
              `${paramName}[${i}]`,
              loc,
            );
          });
        } else if (arg.shape.k !== "unknown" && arg.shape.k !== "any") {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: `array at ${paramName}`,
            suggestion: `改用满足 array 约束的值`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
      // 顶层 int（builder 上 .int 是方法，标志须经 isIntFlag 读）
      if (isIntFlag(c)) {
        const iv = litValue(arg);
        if (typeof iv === "number" && !Number.isInteger(iv)) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: `${paramName} is int`,
            suggestion: `改用整数`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  };

  const parseCallArgs = (
    args: Array<Record<string, unknown>>,
  ): { absArgs: Abs[]; hasInfo: boolean } => {
    const absArgs: Abs[] = [];
    let hasInfo = false;
    for (const a of args ?? []) {
      if (a.type === "NumericLiteral" && typeof a.value === "number") {
        absArgs.push(numLit(a.value));
        hasInfo = true;
      } else if (
        a.type === "UnaryExpression" &&
        (a as { operator?: string }).operator === "-" &&
        (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
      ) {
        const num = (a as { argument: { value: number } }).argument;
        absArgs.push(numLit(-num.value));
        hasInfo = true;
      } else if (a.type === "ObjectExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        if (abs && abs.shape.k === "obj") hasInfo = true;
      } else if (a.type === "ArrayExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        if (abs && (abs.shape.k === "arr" || abs.shape.k === "tuple")) hasInfo = true;
      } else if (a.type === "StringLiteral" && typeof a.value === "string") {
        absArgs.push({
          shape: { k: "prim", type: "string" },
          term: { op: "lit", value: a.value },
          conf: "exact",
        });
        hasInfo = true;
      } else if (a.type === "Identifier" && typeof a.name === "string") {
        const abs = varAbs.get(a.name);
        absArgs.push(abs ?? absUnknown());
        if (abs && abs.shape.k !== "unknown") hasInfo = true;
      } else {
        absArgs.push(absUnknown());
      }
    }
    return { absArgs, hasInfo };
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const { absArgs, hasInfo } = parseCallArgs(args);
    if (!hasInfo || absArgs.length === 0) return;

    const g = generalizeFromAst(fnName, source, {
      file,
      refine: {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
        ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      },
    });
    const paramNames = g?.params ?? [];
    const optsR: EffectiveInterfaceOpts = {
      loadModule: opts?.loadModule,
      fromFile: opts?.fromFile ?? "",
      ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    };
    const ownEi = effectiveInterfaceOf(fnName, source, optsR);
    // §3.3 执法分档：仅 handwritten 执法；generated 段是事实快照（drift 另报）
    if (ownEi?.source === "handwritten") {
      const ownFull = interfaceToIndexed(ownEi, paramNames, g?.formals);
      checkShapeReqs(fnName, ownFull, paramNames, absArgs, (i) => i, loc);
      checkReqs(
        fnName,
        ownFull.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
        paramNames,
        absArgs,
        (i) => i,
        loc,
      );
    }

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tg = generalizeFromAst(fwd.target, source, file ? { file } : {});
      const tParams = tg?.params ?? [];
      const tEi = effectiveInterfaceOf(fwd.target, source, optsR);
      const tFull = tEi?.source === "handwritten" ? interfaceToIndexed(tEi, tParams, tg?.formals) : [];
      if (tFull.length > 0) {
        const wrapperArgOfTarget = new Map<number, number>();
        fwd.map.forEach((wrapperIdx, targetIdx) => {
          wrapperArgOfTarget.set(targetIdx, wrapperIdx);
        });
        const mapArg = (targetIdx: number) => wrapperArgOfTarget.get(targetIdx);
        checkShapeReqs(`${fnName}→${fwd.target}`, tFull, tParams, absArgs, mapArg, loc);
        checkReqs(
          `${fnName}→${fwd.target}`,
          tFull.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
          tParams,
          absArgs,
          mapArg,
          loc,
        );
      }
    }
  };

  const checkExternalCall = (
    ext: ExternalFnRef,
    args: Array<Record<string, unknown>>,
    displayName: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    checkArgStructures(ext.fnName, ext.source, args, loc, displayName, ext.fromFile);
    const { absArgs, hasInfo } = parseCallArgs(args);
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<[number, RefineEntry, string | undefined]> = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
      paramNames = g?.params ?? [];
      // 跨文件侧车只在拿到定义文件路径时 ambient 绑定（防误绑到本文件侧车）
      const eiOpts: EffectiveInterfaceOpts = {
        loadModule: opts?.loadModule,
        fromFile: ext.fromFile ?? opts?.fromFile ?? "",
        ...(ext.fromFile ? {} : { autoBind: false }),
        ...(ext.fromFile && opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      };
      const ei = effectiveInterfaceOf(ext.fnName, ext.source, eiOpts);
      // §3.3 执法分档：仅 handwritten 执法；generated 段不执法
      if (ei?.source === "handwritten") {
        full = interfaceToIndexed(ei, paramNames, g?.formals);
      }
    } catch {
      // 外部被调契约解析失败：不再静默放弃执法——报 warning 便于定位
      out.push({
        severity: "warning",
        code: "nudo:no-signature",
        message: `${displayName}: 外部被调契约解析失败，跳过调用点前置检查`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
    checkShapeReqs(displayName, full, paramNames, absArgs, (i) => i, loc);
    checkReqs(
      displayName,
      full.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
      paramNames,
      absArgs,
      (i) => i,
      loc,
    );
  };

  /**
   * HOF：实参可调用性 / arity（fnRels）。**不做** body 字段 slot 预扫描。
   * 字面量节点静态求 Abs；标识符用文件绑定表。
   */
  /** P4：HOF 实参 fn 形状检查（§6.3 豁免规则） */
  const checkHofFnRelArgs = (
    g: PolyFn,
    args: Array<Record<string, unknown>>,
    loc: { start: { line: number; column: number } } | undefined,
    displayName: string,
    evalArg: (n: Record<string, unknown>) => Abs | undefined,
  ): void => {
    const fnRels = g.fnRels;
    if (!fnRels) return;
    for (let i = 0; i < g.params.length; i++) {
      const pname = g.params[i]!;
      const rel = fnRels.get(pname);
      if (!rel) continue;
      const expected = rel.abs;
      if (expected.shape.k !== "fn") continue;
      const argNode = args[i];
      if (!argNode) continue;
      const absArg = evalArg(argNode);
      if (!absArg) continue;
      // 豁免：any / unknown / 无信息
      if (absArg.shape.k === "any" || absArg.shape.k === "unknown") continue;
      // 豁免：有真实 body 的 impl
      if (getFnImpl(absArg)) continue;
      // 豁免：sum 且任一 member 满足
      if (absArg.shape.k === "sum") {
        const okAny = absArg.shape.members.some((m) =>
          hofFnArgOk(m, expected),
        );
        if (okAny) continue;
      }
      if (!hofFnArgOk(absArg, expected)) {
        // promote 来源 → warning；refine / relationFn → error
        const isPromote = rel.source === "promote";
        out.push({
          severity: isPromote ? "warning" : "error",
          code: "nudo:arg-structure",
          message: `${displayName}[${pname}]: 实参不是可调用的 fn`,
          actual: formatAbs(absArg),
          expected: formatShape(expected),
          suggestion: `期望 ${formatShape(expected)}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
  };

  /**
   * 调用点结构检查。
   *
   * 契约模型（close-ts-dx-gaps §0.1）：义务只来自显式 interface / HOF 关系；
   * **不做** body AST → 必填 slot 预扫描（collectParamStructReqs 已移除）。
   * 本函数仅保留 HOF 实参（回调可调用性 / arity）检查。
   */
  const checkArgStructures = (
    fnName: string,
    fnSource: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
    displayName?: string,
    /** 跨文件时 ext 定义文件路径（保留签名，供未来侧车相关检查）；同文件忽略 */
    _interfaceFromFile?: string,
  ): void => {
    let gFn: ReturnType<typeof generalizeFromAst>;
    try {
      const sameFile = fnSource === source;
      gFn = generalizeFromAst(
        fnName,
        fnSource,
        sameFile && file ? { file } : {},
      );
    } catch (e) {
      out.push({
        severity: "warning",
        code: "nudo:no-signature",
        message: `${displayName ?? fnName}: signature recovery failed (${e instanceof Error ? e.message : String(e)}); skipping call-site checks`,
        fn: displayName ?? fnName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
    // HOF 实参 arity/shape 检查（fnRels + RelSource；与 body 字段扫描无关）
    if (gFn?.fnRels && gFn.fnRels.size > 0) {
      checkHofFnRelArgs(gFn, args, loc, displayName ?? fnName, (n) =>
        evalArgAbs(n, (x) => varAbs.get(x)),
      );
    }
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as Record<string, unknown>;
      const args = (obj.arguments as Array<Record<string, unknown>>) ?? [];
      const resolved = resolveCalleeFn(callee, resolve, knownSet);
      if (typeof resolved === "string") {
        checkOneCall(resolved, args, obj.loc);
      } else if (resolved?.external) {
        const name = resolved.external.fnName || "require()";
        checkExternalCall(resolved.external, args, name, obj.loc);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}

// ---------------------------------------------------------------------------
// T10b：跨文件注入调用点域证据 ⊄ 手写契约（nudo:interface-domain-exceeds）
// ---------------------------------------------------------------------------

/**
 * 注入记录的最小结构面。Abs 为唯一真理源。
 */
export type InjectedDomainRecord = {
  /** 无损参数 Abs（必填；domain 证据唯一来源） */
  argAbs?: Abs[];
  resultAbs?: Abs;
  throwsAbs?: Abs;
};

export type InjectedDomainEvidenceOpts = {
  /** 被调函数形参名（位置序）；契约按参数名对齐证据位 */
  paramNames: string[];
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
  /** 侧车 ambient 绑定开关（host 配置下传；默认 true） */
  autoBind?: boolean;
  /** 报告定位：被调函数声明处。注入证据的 loc 在使用现场文件，不属于本文件 */
  loc?: { line: number; column: number };
};

/** 字面量证据展示：字符串带引号，number/boolean 原样 */
function evidenceToString(v: number | string | boolean): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/**
 * 跨文件注入的调用点域证据 vs 手写契约（设计稿 §3.3/§6 对账矩阵第一行）。
 *
 * 来源分流铁律：写在被分析文件里的调用点违例（含 scanLiteralCalls 的
 * checkExternalCall 跨文件被调路径）维持 `nudo:constraint-violated` 原码
 * 原语义——本函数**只**消费经 externalCallRecords 注入的跨文件记录（analyzer
 * 消费区已做归属守卫），该路径此前不查契约，是纯增量。
 *
 * 证据门槛（§6）：
 * - 只有 plain literal 实参构成证据：union/unknown/primitive/refined 形态
 *   无法归因到确定值，不参与。Abs 路径直接读 `litValue` + conf
 *   ∈ {exact, path}。
 * - null 证据预过滤（T4 caveat：lit(null) 编码 prim undefined + eq(self,
 *   null)，对任何约束恒不满足，不过滤必 FP）；undefined/bigint/symbol
 *   不在字面量证据域内，一并跳过；
 * - resultType=never ∧ throws=never 是求值中断泄漏（analyzer 注入消费区
 *   同款过滤；有 resultAbs/throwsAbs 时同口径）。CallRecord 上没有截断字段
 *   （查证于 evaluator.ts CallRecord 声明）——递归截断走
 *   nudo:recursion-truncated 诊断通道且只 widen 结果，不产生新字面量证据；
 * - fn/shape/array 参数位 Phase 1 不执法（§3.3 HOF 豁免：
 *   literalMeetsConstraint 对这些形态恒 false，直接查必 FP）。
 *
 * 每函数每参数位最多一条 issue（多证据并列在 actual 里，去重）。
 */
export function checkInjectedDomainEvidence(
  fnName: string,
  source: string,
  records: InjectedDomainRecord[],
  opts: InjectedDomainEvidenceOpts,
): CheckIssue[] {
  const isLeaked = (r: InjectedDomainRecord): boolean => {
    if (r.resultAbs && r.throwsAbs) {
      return r.resultAbs.shape.k === "never" && r.throwsAbs.shape.k === "never";
    }
    return false;
  };
  const usable = records.filter((r) => !isLeaked(r));
  if (usable.length === 0) return [];

  let ei: EffectiveInterface | undefined;
  try {
    ei = effectiveInterface(source, fnName, {
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      fromFile: opts.fromFile,
      ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    });
  } catch (e) {
    return [
      {
        severity: "warning",
        code: "nudo:interface-load",
        message: `${fnName}: effective interface load failed (${e instanceof Error ? e.message : String(e)}); skipping domain-exceeds check`,
        fn: fnName,
        line: opts.loc?.line,
        column: opts.loc?.column,
      },
    ];
  }
  // §3.3 执法分档：仅手写契约执法。generated 段是事实快照（过期由
  // nudo:interface-drift 覆盖）；implicit 无契约。
  if (!ei || ei.source !== "handwritten") return [];

  const out: CheckIssue[] = [];
  for (const { param, constraint } of ei.params) {
    if (constraint.fields || constraint.element || constraint.fn) continue;
    const idx = opts.paramNames.indexOf(param);
    // 形参名对不上（解构/rest/改名）：证据无法归位，跳过不猜
    if (idx < 0) continue;
    const failures: Array<number | string | boolean> = [];
    for (const rec of usable) {
      const lit = extractLiteralEvidence(rec, idx);
      if (lit === undefined) continue;
      if (!literalMeetsConstraint(lit, constraint)) failures.push(lit);
    }
    if (failures.length === 0) continue;
    const shown = [...new Set(failures)].map(evidenceToString).join(", ");
    out.push({
      severity: "error",
      code: "nudo:interface-domain-exceeds",
      message: `${fnName}[${param}]: cross-file call-site domain evidence ${shown} exceeds handwritten contract`,
      actual: shown,
      expected: formatConstraint(constraint),
      suggestion: `Loosen the handwritten contract for ${fnName} (${param}: ${formatConstraint(constraint)}), or fix the caller's values`,
      fn: fnName,
      line: opts.loc?.line,
      column: opts.loc?.column,
    });
  }
  return out;
}

/**
 * 单条记录在参数位 idx 的字面量证据。
 * Abs 无损 lit + conf 门槛。
 * 非字面量 / conf 门槛不过 / null·undefined·bigint·symbol → undefined。
 */
function extractLiteralEvidence(
  rec: InjectedDomainRecord,
  idx: number,
): number | string | boolean | undefined {
  const absArg = rec.argAbs?.[idx];
  if (!absArg) return undefined;
  if (absArg.conf !== "exact" && absArg.conf !== "path") return undefined;
  const lv = litValue(absArg);
  if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") {
    return lv;
  }
  return undefined;
}
