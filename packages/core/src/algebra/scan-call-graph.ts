/**
 * 调用图收集（别名 / 对象属性 / require / 动态 import / 无条件转发）。
 *
 * 从 scan.ts 拆出的纯 AST 解析层：不共享 scanLiteralCalls 的执法状态，
 * 只产出 CallResolve / Forward 表供扫描侧消费。
 */

import { parseSource as parse } from "./parse-source.ts";
import { foldRequireSpecArg } from "./exec/transpile.ts";
import { resolveDepPath } from "./load-deps-fp.ts";
import { listTopFunctions } from "./scan-top-functions.ts";

// ---------------------------------------------------------------------------
// 调用图收集（别名 / 对象属性 / require / 动态 import / 无条件转发）
// ---------------------------------------------------------------------------

/** 外部模块函数：源码 + 导出名 + 定义文件虚拟路径（interface 侧车解析基；不可得 → 省略） */
export type ExternalFnRef = { source: string; fnName: string; fromFile?: string };

/** 扫描前收集：别名 / 对象属性 / require 导入 */
export type CallResolve = {
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
  // require('./x') / require(`./x`) / require("./" + "x" + ".js")
  if (init.type === "CallExpression") {
    const callee = init.callee as { type?: string; name?: string } | undefined;
    const args = init.arguments as Array<Record<string, unknown>> | undefined;
    if (callee?.type === "Identifier" && callee.name === "require" && args?.[0]) {
      return foldRequireSpecArg(args[0]);
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

export function collectCallResolvers(
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
            } else if (sp.type === "ImportDefaultSpecifier") {
              // 默认导出字面量名 "default"（与 interface/refine/generalize/abs-modules/check 同口径）
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                bindExternal(local.name, modSrc, "default", String(spec.value));
              }
            }
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
export function resolveCalleeFn(
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
export type Forward = { target: string; map: number[] };

export function collectForwarders(
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
