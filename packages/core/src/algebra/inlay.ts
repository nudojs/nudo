/**
 * Abs inlay hint：把无损约束内联到源码位置。
 * 不是 TS 风格 type annotation 复读，而是 term/pred/conf 的计算结果。
 */

import type { Node, FunctionDeclaration } from "@babel/types";
import { parseSource as parse } from "./parse-source.ts";
import { generalizeFromAst } from "./generalize.ts";
import { formatShape } from "./format.ts";
import { predToString, type Pred } from "./pred.ts";
import { termToString } from "./term.ts";

export type AbsInlay = {
  /** 1-based 行号 */
  line: number;
  /** 0-based 列（label 插入点） */
  character: number;
  label: string;
  kind: "type" | "parameter";
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

/** 从函数体抽 param 的前置 Pred（与 check 同源逻辑的轻量版） */
function paramPreds(
  source: string,
  fnName: string,
  paramNames: string[],
): Map<string, Pred[]> {
  const byIndex = new Map<number, Pred[]>();
  const file = parse(source);
  const paramIndex = new Map(paramNames.map((p, i) => [p, i]));

  const pushCmp = (
    test: Record<string, unknown>,
    consequent: Record<string, unknown> | undefined,
  ): void => {
    if (test?.type !== "BinaryExpression") return;
    const left = test.left as { type?: string; name?: string };
    const right = test.right as { type?: string; value?: number };
    const op = test.operator as string;
    if (
      left?.type !== "Identifier" ||
      !left.name ||
      !paramIndex.has(left.name) ||
      right?.type !== "NumericLiteral" ||
      typeof right.value !== "number"
    ) {
      return;
    }
    const isReturnParam =
      consequent?.type === "ReturnStatement" &&
      (consequent.argument as { type?: string; name?: string })?.type === "Identifier" &&
      (consequent.argument as { name?: string }).name === left.name;
    if (!isReturnParam) return;
    const idx = paramIndex.get(left.name)!;
    const t = { op: "var" as const, id: left.name };
    const b = { op: "lit" as const, value: right.value };
    let pred: Pred | undefined;
    if (op === ">") pred = { op: "gt", a: t, b };
    else if (op === ">=") pred = { op: "ge", a: t, b };
    else if (op === "<") pred = { op: "lt", a: t, b };
    else if (op === "<=") pred = { op: "le", a: t, b };
    if (!pred) return;
    const list = byIndex.get(idx) ?? [];
    list.push(pred);
    byIndex.set(idx, list);
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "IfStatement") {
      const test = obj.test as Record<string, unknown>;
      const consequent = obj.consequent as Record<string, unknown> | undefined;
      pushCmp(test, consequent);
      if (test?.type === "LogicalExpression" && test.operator === "&&") {
        pushCmp(test.left as Record<string, unknown>, consequent);
        pushCmp(test.right as Record<string, unknown>, consequent);
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

  const byName = new Map<string, Pred[]>();
  for (const [idx, preds] of byIndex) {
    const name = paramNames[idx];
    if (name) byName.set(name, preds);
  }
  return byName;
}

/**
 * 收集源码中函数签名的 Abs inlay：
 * - 参数后：前置约束（`x > 0`）
 * - `)` 后：返回 shape + term（类型即计算）
 */
export function collectAbsInlays(source: string): AbsInlay[] {
  const inlays: AbsInlay[] = [];
  for (const { name, node } of listFunctions(source)) {
    let g: ReturnType<typeof generalizeFromAst>;
    try {
      g = generalizeFromAst(name, source);
    } catch {
      continue;
    }
    if (!g) continue;

    const params = g.params;
    const predsByName = paramPreds(source, name, params);

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
        });
      }
    }

    // 返回：插在函数体 `{` 前（类型即计算）
    const bodyLoc = fnNode.body?.loc;
    if (bodyLoc?.start) {
      const retShape = formatShape(g.symbolic);
      let label = `: ${retShape}`;
      if (g.symbolic.term && g.symbolic.term.op !== "lit") {
        label += ` = ${termToString(g.symbolic.term)}`;
      }
      if (g.symbolic.pred && g.symbolic.pred.op !== "true") {
        label += `  where ${predToString(g.symbolic.pred)}`;
      }
      inlays.push({
        line: bodyLoc.start.line,
        character: Math.max(0, bodyLoc.start.column),
        label: `${label}  `,
        kind: "type",
      });
    }
  }
  return inlays;
}
