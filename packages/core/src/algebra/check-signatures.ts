/**
 * 入口签名格式化（L0 命中缓存 / default 判定 / 形参个数估计 / 声明定位）。
 *
 * 从 check.ts 拆出的展示与定位基建：与 checkSourceInner 状态无耦合，
 * 只消费 Abs / PolyFn / parse 结果。findFnLoc 兼供 L2 may-throw 诊断定位。
 */

import type { parseSource } from "./parse-source.ts";
import type { Abs } from "./abs.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import type { PolyFn } from "./generalize.ts";

type ParsedFile = ReturnType<typeof parseSource>;

/** L0 命中的 symbolic 对象稳定：display/detail 按 Abs 身份缓存 */
const sigFormatCache = new WeakMap<Abs, { display: string; detail: string }>();

/** 入口形参个数估计（CJS / generalize 失败时喂 any 实参） */
export function estimateEntryParamCount(
  source: string,
  fnName: string,
  file: ParsedFile,
): number {
  try {
    for (const stmt of file.program.body) {
      const nodes: unknown[] = [stmt];
      if (
        stmt.type === "ExportNamedDeclaration" ||
        stmt.type === "ExportDefaultDeclaration"
      ) {
        nodes.push((stmt as { declaration?: unknown }).declaration);
      }
      if (stmt.type === "ExpressionStatement") {
        const expr = (stmt as { expression?: { right?: unknown } }).expression;
        nodes.push(expr?.right);
      }
      for (const n of nodes) {
        const node = n as {
          type?: string;
          id?: { name?: string };
          params?: unknown[];
          properties?: Array<{
            key?: { type?: string; name?: string; value?: unknown };
            value?: unknown;
          }>;
        };
        if (!node) continue;
        const isFn =
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression";
        if (isFn && (node.id?.name === fnName || !node.id)) {
          return node.params?.length ?? 0;
        }
        if (node.type === "ObjectExpression") {
          for (const p of node.properties ?? []) {
            const keyName =
              p.key?.type === "Identifier"
                ? (p.key as { name?: string }).name
                : p.key && (p.key.type === "StringLiteral" || p.key.type === "NumericLiteral")
                  ? String(p.key.value)
                  : undefined;
            if (String(keyName) !== fnName) continue;
            const v = p.value as { type?: string; params?: unknown[] };
            if (
              v &&
              (v.type === "FunctionExpression" || v.type === "ArrowFunctionExpression")
            ) {
              return v.params?.length ?? 0;
            }
          }
        }
      }
    }
  } catch {
    /* fallthrough */
  }
  const re = new RegExp(
    `(?:function\\s+${fnName}\\s*\\(([^)]*)\\)|${fnName}\\s*=\\s*(?:async\\s*)?function(?:\\s+${fnName})?\\s*\\(([^)]*)\\)|${fnName}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>)`,
  );
  const m = re.exec(source);
  if (m) {
    const args = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!args) return 0;
    return args.split(",").filter((s) => s.trim().length > 0).length;
  }
  return 1;
}

/** export default 是否绑定到该本地函数名 */
export function isDefaultExportName(source: string, fnName: string): boolean {
  // export default function fn / export default fn / export default () =>
  const re = new RegExp(
    `export\\s+default\\s+(?:async\\s+)?(?:function\\s+${fnName}\\b|${fnName}\\b)`,
  );
  return re.test(source);
}

export function formatEntrySigLine(name: string, g: PolyFn, throws: string): string {
  const ps = g.params
    .map((p, i) => {
      const t = g.typeParams[i]?.value;
      // design §2：无约束 any；真 unknown 不得伪装
      const shown = !t ? "any" : t.shape.k === "unknown" ? "unknown" : formatShape(t);
      return `${p}: ${shown}`;
    })
    .join(", ");
  return `${name}(${ps}) => ${formatShape(g.symbolic)}    throws ${throws}`;
}

/** 入口函数节点位置（L2 诊断定位；找不到则省略） */
export function findFnLoc(
  file: ParsedFile,
  name: string,
): { line?: number; column?: number } {
  type LocNode = { loc?: { start?: { line?: number; column?: number } }; type?: string };
  const startOf = (n: LocNode | null | undefined) => n?.loc?.start;
  try {
    for (const stmt of file.program.body as unknown as LocNode[]) {
      let decl: LocNode | null | undefined = stmt;
      const s = stmt as unknown as {
        type?: string;
        declaration?: LocNode | null;
      };
      if (s.type === "ExportNamedDeclaration" && s.declaration) decl = s.declaration;
      if (s.type === "ExportDefaultDeclaration" && s.declaration) decl = s.declaration;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        const id = (decl as unknown as { id?: { name?: string } }).id;
        if (id?.name === name) {
          const st = startOf(decl);
          return { line: st?.line, column: st?.column };
        }
      }
      if (decl.type === "VariableDeclaration") {
        const decls =
          (decl as unknown as { declarations?: Array<LocNode & { id?: { name?: string } }> })
            .declarations ?? [];
        for (const d of decls) {
          if (d.id?.name === name) {
            const st = startOf(d);
            return { line: st?.line, column: st?.column };
          }
        }
      }
      if (name === "default" && s.type === "ExportDefaultDeclaration") {
        const st = startOf(s.declaration) ?? startOf(stmt);
        return { line: st?.line, column: st?.column };
      }
    }
  } catch {
    /* loc is best-effort */
  }
  return {};
}

export function formatSigCached(absVal: Abs, name: string): { display: string; detail: string } {
  const hit = sigFormatCache.get(absVal);
  if (hit) return hit;
  const out = {
    display: formatAbs(absVal),
    detail: formatAbsMultiline(absVal, name),
  };
  sigFormatCache.set(absVal, out);
  return out;
}
