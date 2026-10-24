/**
 * 入口签名格式化（L0 命中缓存 / default 判定 / 形参个数估计 / 声明定位）。
 *
 * 从 check.ts 拆出的展示与定位基建：与 checkSourceInner 状态无耦合，
 * 只消费 Abs / PolyFn / parse 结果。findFnLoc 兼供 L2 may-throw 诊断定位。
 */

import type { parseSource } from "./parse-source.ts";
import type { Abs } from "./abs.ts";
import { formatAbsMultiline, formatShape } from "./format.ts";
import { identBoundaryRegex } from "./code-text.ts";
import { absWithStableTermIds } from "./check-report.ts";
import type { PolyFn } from "./generalize.ts";
import { formalParamSignatureNames } from "./param-surface.ts";

type ParsedFile = ReturnType<typeof parseSource>;

/**
 * L0 命中的 symbolic 对象稳定：display/detail 按 (Abs 身份, 函数名) 缓存。
 *
 * Bug 377：缓存键**只有 Abs 对象身份**，但缓存值 `detail` 内嵌**函数名**
 * （`formatAbsMultiline(absVal, name)`）⇒ 共享同一 Abs 单例（`never` /
 * `unknown` 是 `abs.ts` 的模块级单例）的第 2/3 个函数**串号**（`detail`
 * 全写着第一个函数的名字）⇒ JSON 信封里 `name` 与 `detail` 自相矛盾。
 * ⇒ 键必须覆盖值的全部依赖：Abs 身份 **+** 函数名。
 */
const sigFormatCache = new WeakMap<Abs, Map<string, { display: string; detail: string }>>();

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
  // JS 标识符含 `$`：两侧用 lookaround，不用 `\b`（`\b` 会把 `alf` 的尾巴 `f` 当独立名）
  const name = identBoundaryRegex(fnName);
  const re = new RegExp(
    `(?:function\\s+${name}\\s*\\(([^)]*)\\)|${name}\\s*=\\s*(?:async\\s*)?function(?:\\s+${name})?\\s*\\(([^)]*)\\)|${name}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>)`,
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
  // 边界用 lookaround 而非 `\b`：`$` 是标识符字符，`\b` 会漏 `foo$`、误命中 `$fn$`
  const name = identBoundaryRegex(fnName);
  const re = new RegExp(
    `export\\s+default\\s+(?:async\\s+)?(?:function\\s+${name}|${name})`,
  );
  return re.test(source);
}

/**
 * 入口形参位 → 展示串（Bug 348 / 965）。
 *
 * - `shape.k === "unknown"`：term 是 nullish 字面量（lit null / lit undefined）
 *   ⇒ 印它自己的名字（`null` / `undefined`），不得与「真 unknown」混淆
 *   （design §2：真 unknown 不伪装成 any）；否则照旧印 `unknown`。
 * - 其余：pred 把该项钉死成单个字面量（`eq(self, lit(v))`）时印 `lit(v)`
 *   ——字面量只活在 **pred** 里（shape 无字面量位），只读 shape 的渲染面
 *   看不见它（契约面 `(x: lit(1))` / dts / zod / standard 三面都看得见）。
 */
export function formatEntryParamShape(t: Abs): string {
  if (t.shape.k === "unknown") {
    const term = t.term;
    if (term?.op === "lit" && (term.value === null || term.value === undefined)) {
      return formatShape(t);
    }
    return "unknown";
  }
  return formatShape(t, { showLits: true });
}

export function formatEntrySigLine(name: string, g: PolyFn, throws: string): string {
  const names =
    g.formals && g.formals.length > 0 ? formalParamSignatureNames(g.formals) : g.params;
  const ps = names
    .map((p, i) => {
      const t = g.typeParams[i]?.value;
      // design §2：无约束 any；真 unknown 不得伪装
      const shown = !t ? "any" : formatEntryParamShape(t);
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

/**
 * 签名的多行明细（机器面 `signatures[].detail` 与人类面 `--verbose` **同源**）。
 *
 * 形态沿用 `formatAbsMultiline`（首行 = 函数名 —— Bug 377 的「不得串号」
 * 依赖它）；**term / pred 里的引擎内部计数器 id 换成稳定名**（`len#2` →
 * `len`）—— 编号随进程漂移 ⇒ 不得进对外载荷（Bug 413），而谓词证据
 * （`len ≥ 0`）必须保留。
 */
function formatSigDetail(absVal: Abs, name: string): string {
  return formatAbsMultiline(absWithStableTermIds(absVal), name);
}

export function formatSigCached(absVal: Abs, name: string): { display: string; detail: string } {
  // 键 = (Abs 身份, 函数名)：detail 内嵌函数名 ⇒ 名字必须进键（Bug 377）
  let byName = sigFormatCache.get(absVal);
  if (!byName) {
    byName = new Map<string, { display: string; detail: string }>();
    sigFormatCache.set(absVal, byName);
  }
  const hit = byName.get(name);
  if (hit) return hit;
  const out = {
    // **人类面口径**（`formatShape`）：与 `formatCheckReport` 的签名行**逐字
    // 同源**（Bug 413：机器面此前用 `formatAbs` ⇒ 把 term / pred 段渲进
    // 对外载荷，其中混着引擎内部计数器 id `len#N` ⇒ 载荷随参数列表位置漂移）。
    display: formatShape(absVal),
    detail: formatSigDetail(absVal, name),
  };
  byName.set(name, out);
  return out;
}
