/**
 * Abs inlay hint：把无损约束内联到源码位置。
 * 不是 TS 风格 type annotation 复读，而是 term/pred/conf 的计算结果。
 *
 * 参数侧只展示显式 `@nudo:refine` 契约（entryReqs）——
 * 不从函数体 `if` 反推前置条件（那是控制流，不是对外契约）。
 *
 * A7（design-refine-derivation §8）：default 走 symbolic + entryReqs；
 * 与 CodeLens `● interface` 同源——interfaceTierOf 标注来源；
 * implicit 导出的返回 inlay 标明 `derived`（展示档，非义务契约）。
 */

import type { Node, FunctionDeclaration } from "@babel/types";
import { parseSource as parse } from "./parse-source.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import { formatShape } from "./format.ts";
import { predToString } from "./pred.ts";
import { termToString } from "./term.ts";
import { litValue, type Abs } from "./abs.ts";
import { interfaceTierOf, type InterfaceSource, type InterfaceTierOpts } from "./interface.ts";

export type AbsInlay = {
  /** 1-based 行号 */
  line: number;
  /** 0-based 列（label 插入点） */
  character: number;
  label: string;
  kind: "type" | "parameter";
  /** interface 档来源（与 CodeLens `● interface` 同源）；非导出缺省 */
  interfaceSource?: InterfaceSource;
  /** true = 隐式推导展示（非义务契约），label 已带 `· derived` */
  derived?: boolean;
};

export type CollectAbsInlaysOpts = InterfaceTierOpts & {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
};

function listFunctions(source: string): Array<{ name: string; node: Node }> {
  const file = parse(source);
  const out: Array<{ name: string; node: Node }> = [];
  const visitDecl = (decl: Node): void => {
    if (decl.type === "FunctionDeclaration" && (decl as FunctionDeclaration).id) {
      const fd = decl as FunctionDeclaration;
      out.push({ name: fd.id!.name, node: fd });
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of (decl as any).declarations ?? []) {
        if (
          d.id?.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
        ) {
          out.push({ name: d.id.name, node: d.init });
        }
      }
    }
  };
  for (const stmt of file.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      visitDecl(stmt.declaration as Node);
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      visitDecl(stmt.declaration as Node);
    } else {
      visitDecl(stmt);
    }
  }
  return out;
}

/** A1 → 源码参数名，便于 inlay 阅读 */
function renameTypeVars(s: string, varMap: Map<string, string>): string {
  let out = s;
  // 长 id 先替换，避免 A1 误伤 A10
  const ids = [...varMap.keys()].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    out = out.replaceAll(id, varMap.get(id)!);
  }
  return out;
}

/**
 * 返回值 inlay：路径摘要（对应源码 return），不是精化后的外延类型。
 * `double` → `x | x * 2`；`scale` → `x + 1`。
 * `where` / ToNumber 拆分留给 hover 展开。
 */
function formatReturnDisplay(g: PolyFn): string {
  const varMap = new Map<string, string>();
  for (let i = 0; i < (g.typeParams?.length ?? 0); i++) {
    const id = g.typeParams![i]!.id;
    const pname = g.params[i];
    if (pname) varMap.set(id, pname);
  }

  const stripParens = (t: string): string =>
    t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1) : t;

  const memberPath = (m: Abs): { key: string; text: string } => {
    if (m.term?.op === "var") {
      const name = renameTypeVars(m.term.id, varMap);
      return { key: `var:${name}`, text: name };
    }
    if (m.term?.op === "app") {
      const t = stripParens(renameTypeVars(termToString(m.term), varMap));
      return { key: `app:${t}`, text: t };
    }
    const lv = litValue(m);
    if (typeof lv === "number" && !Number.isFinite(lv)) {
      return { key: `lit:${String(lv)}`, text: String(lv) };
    }
    if (lv !== undefined) {
      return { key: `lit:${String(lv)}`, text: JSON.stringify(lv) };
    }
    return { key: `shape:${formatShape(m)}`, text: formatShape(m) };
  };

  const abs = g.symbolic;
  // 外层 term：单路径计算形（`x + 1`）
  if (abs.term && abs.term.op !== "lit") {
    return stripParens(renameTypeVars(termToString(abs.term), varMap));
  }
  if (abs.shape.k === "sum") {
    // 同 term 的精化臂（number>3 | string 都是 A1）合并为一条路径 `x`
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const m of abs.shape.members) {
      const { key, text } = memberPath(m);
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" | ");
  }
  return memberPath(abs).text;
}

/**
 * 收集源码中函数签名的 Abs inlay：
 * - 参数后：仅 `@nudo:refine` / 侧车显式契约（entryReqs）
 * - `{` 前：返回计算形（`x | x * 2`），无 term 时退回 shape
 * - interface 档：导出函数带 `interfaceSource`；implicit 返回标 `derived`
 */
export function collectAbsInlays(
  source: string,
  opts?: CollectAbsInlaysOpts,
): AbsInlay[] {
  const inlays: AbsInlay[] = [];
  const refineOpts =
    opts?.loadModule || opts?.fromFile
      ? {
          ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
          ...(opts.fromFile ? { fromFile: opts.fromFile } : {}),
        }
      : undefined;

  for (const { name, node } of listFunctions(source)) {
    let g: ReturnType<typeof generalizeFromAst>;
    try {
      g = generalizeFromAst(name, source, refineOpts ? { refine: refineOpts } : {});
    } catch {
      continue;
    }
    if (!g) continue;

    // A7：与 CodeLens `● interface` 同源；仅本地 named export 进档
    const tier =
      opts?.fromFile !== undefined
        ? interfaceTierOf(source, name, opts.fromFile, {
            ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
            ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
          })
        : undefined;
    const tierSrc = tier?.source;
    const isImplicitExport = tierSrc === "implicit";

    const params = g.params;
    const predsByName = new Map<string, import("./pred.ts").Pred[]>();
    if (g.entryReqs) {
      for (const r of g.entryReqs) {
        predsByName.set(r.param, [r.pred]);
      }
    }

    const fnNode = node as any;
    const paramList: any[] = fnNode.params ?? [];
    for (let i = 0; i < paramList.length; i++) {
      const p = paramList[i];
      const pname = params[i] ?? (p?.name as string | undefined);
      if (!p?.loc || !pname) continue;
      const preds = predsByName.get(pname);
      if (preds && preds.length > 0) {
        const text = preds.map(predToString).join(" ∧ ");
        inlays.push({
          line: p.loc.end.line,
          character: p.loc.end.column,
          label: `  where ${text}`,
          kind: "parameter",
          ...(tierSrc ? { interfaceSource: tierSrc } : {}),
        });
      }
    }

    // 返回：插在函数体 `{` 前——优先 term/路径形；implicit 导出标明 derived
    const bodyLoc = fnNode.body?.loc;
    if (bodyLoc?.start) {
      let label: string;
      try {
        label = `: ${formatReturnDisplay(g)}`;
      } catch {
        label = `: ${formatShape(g.symbolic)}`;
      }
      if (isImplicitExport) label += "  · derived";
      inlays.push({
        line: bodyLoc.start.line,
        character: Math.max(0, bodyLoc.start.column),
        label: `${label}  `,
        kind: "type",
        ...(tierSrc ? { interfaceSource: tierSrc } : {}),
        ...(isImplicitExport ? { derived: true } : {}),
      });
    }
  }
  return inlays;
}
