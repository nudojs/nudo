/**
 * requires → Pred 编译。
 *
 * 内联片段：`x > 0` / `x >= 0` / `x < 10` / `x <= 10`（字面量右端），`&&` 连接。
 * 绑定引用：`@nudo:requires V.delay`，配合
 *   /// @nudo:import * as V from "./interface.nudo.js"
 * 接口文件导出 pred 字符串：`export const delay = "ms > 0";`
 */

import type { Pred } from "./pred.ts";
import { v as termVar, lit } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import type { Node } from "@babel/types";

const CMP = /^(?<name>[A-Za-z_$][\w$]*)\s*(?<op>>=|<=|>|<)\s*(?<n>-?\d+(?:\.\d+)?)$/;

export function compileRequiresExpr(expr: string): { param: string; pred: Pred } | undefined {
  const m = expr.trim().match(CMP);
  if (!m?.groups) return undefined;
  const name = m.groups.name!;
  const op = m.groups.op!;
  const n = Number(m.groups.n);
  if (!Number.isFinite(n)) return undefined;
  const t = termVar(name);
  const b = lit(n);
  switch (op) {
    case ">":
      return { param: name, pred: { op: "gt", a: t, b } };
    case ">=":
      return { param: name, pred: { op: "ge", a: t, b } };
    case "<":
      return { param: name, pred: { op: "lt", a: t, b } };
    case "<=":
      return { param: name, pred: { op: "le", a: t, b } };
    default:
      return undefined;
  }
}

/** `/// @nudo:import * as V from "./interface.nudo.js"` */
export type NudoImport = { ns: string; spec: string };

export function extractNudoImports(source: string): NudoImport[] {
  const out: NudoImport[] = [];
  const re = /@nudo:import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    out.push({ ns: m[1]!, spec: m[2]! });
  }
  return out;
}

/**
 * 从接口源码抽 `export const name = "pred";`
 * 也支持 `export const name = { pred: "x > 0" };`
 */
export function parseInterfaceConstraints(intfSource: string): Map<string, string> {
  const map = new Map<string, string>();
  const file = parseSource(intfSource);
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "ExportNamedDeclaration" && obj.declaration) {
      const decl = obj.declaration as Record<string, unknown>;
      if (decl.type === "VariableDeclaration") {
        for (const d of (decl.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
          const id = d.id as { type?: string; name?: string };
          const init = d.init as Record<string, unknown> | null | undefined;
          if (id?.type !== "Identifier" || !id.name || !init) continue;
          if (init.type === "StringLiteral" && typeof init.value === "string") {
            map.set(id.name, init.value);
          } else if (init.type === "ObjectExpression") {
            for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
              if (p.type !== "ObjectProperty") continue;
              const key = p.key as { type?: string; name?: string } | undefined;
              const val = p.value as { type?: string; value?: unknown } | undefined;
              if (
                key?.type === "Identifier" &&
                key.name === "pred" &&
                val?.type === "StringLiteral" &&
                typeof val.value === "string"
              ) {
                map.set(id.name, val.value);
              }
            }
          }
        }
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
  return map;
}

export type RequiresResolveOpts = {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
};

/** 解析 `V.delay` → pred 表达式字符串 */
function resolveBoundPred(
  expr: string,
  imports: NudoImport[],
  opts: RequiresResolveOpts,
): string | undefined {
  const m = expr.trim().match(/^(\w+)\.(\w+)$/);
  if (!m) return undefined;
  const [, ns, name] = m;
  const imp = imports.find((i) => i.ns === ns);
  if (!imp || !opts.loadModule || !opts.fromFile) return undefined;
  const src = opts.loadModule(imp.spec, opts.fromFile);
  if (!src) return undefined;
  return parseInterfaceConstraints(src).get(name!);
}

/** 从源码抽函数上的 @nudo:requires（内联或 V.binding） */
export function extractRequiresFromSource(
  source: string,
  fnName: string,
  opts: RequiresResolveOpts = {},
): Array<[number, Pred]> {
  const out: Array<[number, Pred]> = [];
  const imports = extractNudoImports(source);
  const fnRe = new RegExp(
    `(?:export\\s+default\\s+)?(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return out;
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  const reqs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      const rm = line.match(/@nudo:requires\s+(.+)$/);
      if (rm) reqs.unshift(rm[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    break;
  }
  for (const expr of reqs) {
    for (const part of expr.split(/&&/)) {
      const trimmed = part.trim();
      let predExpr = trimmed;
      if (/^\w+\.\w+$/.test(trimmed)) {
        predExpr = resolveBoundPred(trimmed, imports, opts) ?? trimmed;
      }
      const c = compileRequiresExpr(predExpr);
      if (c) {
        out.push([-1, c.pred]);
        (out[out.length - 1] as any).param = c.param;
      }
    }
  }
  return out;
}

/** 把按名的 requires 映射到参数下标 */
export function requiresToIndexed(
  source: string,
  fnName: string,
  paramNames: string[],
  opts: RequiresResolveOpts = {},
): Array<[number, Pred]> {
  const raw = extractRequiresFromSource(source, fnName, opts);
  const out: Array<[number, Pred]> = [];
  for (const item of raw) {
    const paramName = (item as any).param as string | undefined;
    if (!paramName) continue;
    const idx = paramNames.indexOf(paramName);
    if (idx >= 0) out.push([idx, item[1]]);
  }
  return out;
}
