import {
  formatShape,
  formalParamSignatureNames,
  type Abs,
  type PolyFn,
} from "@nudojs/core";
import type { Node } from "@babel/types";
import { MarkupKind, type SignatureHelp, type SignatureInformation } from "vscode-languageserver/node";

/**
 * Signature help 投影：fn Abs → LSP SignatureHelp。
 * 参数位用 formatShape 外延（paramTypes 缺失 → any；返回缺失 → unknown）。
 *
 * `activeParameter` 是**签名参数表内的下标**（LSP 协议取值域；越界值客户端
 * 只能回落 0 ⇒ 会高亮错误的参数）⇒ 必须夹进 [0, paramLabels.length-1]；
 * 参数表为空 ⇒ **省略**该字段（不是填 0）。
 */
export function buildSignatureHelp(fnAbs: Abs, activeParam: number): SignatureHelp | null {
  if (!fnAbs || fnAbs.shape.k !== "fn") return null;
  const shape = fnAbs.shape as {
    params?: string[];
    paramTypes?: Abs[];
    returnType?: Abs;
  };
  const labels = shape.params ?? [];
  const paramTypes = shape.paramTypes;
  const n = Math.max(labels.length, paramTypes?.length ?? 0);
  const paramLabels: string[] = [];
  for (let i = 0; i < n; i++) {
    const name = labels[i] ?? `arg${i}`;
    paramLabels.push(renderParamLabel(name, paramTypes?.[i]));
  }
  const retText = shape.returnType ? formatShape(shape.returnType) : "unknown";
  return finishSignatureHelp(paramLabels, retText, activeParam, formatShape(fnAbs));
}

/**
 * 泛化（PolyFn）→ SignatureHelp：**AST 定位回落面**。
 *
 * 绑定面（`AnalysisResult.bindings`）只覆盖**具名导出**与模块级绑定 ⇒
 * `export default function defFn` 与函数体内的局部 callee 都不在表里
 * ⇒ 弹窗整面无响应（Bug 985 / 986）。本面按 **AST 定位**（与 hover 面
 * `generalizeFromAst` 同源）取形参表面 ⇒ 同一份源码给出同一份签名。
 */
export function buildSignatureHelpFromPolyFn(g: PolyFn, activeParam: number): SignatureHelp {
  const names =
    g.formals && g.formals.length > 0 ? formalParamSignatureNames(g.formals) : g.params;
  const paramLabels = names.map((name, i) => renderParamLabel(name, g.typeParams[i]?.value));
  const retText = formatShape(g.symbolic);
  return finishSignatureHelp(paramLabels, retText, activeParam, g.display);
}

/**
 * 降级签名：被调者**解析不出**（绑定面 miss + AST 定位 miss）⇒ 给出被调者
 * 标识符 + 空参数表 —— IDE 里至少有一层反馈，而不是静默 `null`
 * （「没有签名」与「Nudo 不知道」必须可区分）。
 */
export function buildDegradedSignatureHelp(calleeName: string): SignatureHelp {
  return {
    signatures: [
      {
        label: `${calleeName}(…)`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: "```nudo\n" + calleeName + "\n```\n\n(signature not inferred)",
        },
        parameters: [],
      },
    ],
    activeSignature: 0,
  };
}

/**
 * Abs 形状下钻：取成员槽位的 Abs。
 * 成员调用（`obj.method(…)`）的被调者是**接收者的槽位**，不是模块级绑定
 * ⇒ 签名面必须沿 Abs 形状逐段下钻（Bug 720）。
 */
export function memberSlotAbs(base: Abs | null | undefined, key: string): Abs | undefined {
  if (!base) return undefined;
  const s = base.shape;
  switch (s.k) {
    case "obj":
      return s.slots[key]?.value;
    case "brand":
      return memberSlotAbs(s.shape, key);
    case "fn":
      return s.slots?.[key]?.value;
    case "sum": {
      for (const m of s.members) {
        const hit = memberSlotAbs(m, key);
        if (hit) return hit;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** 成员表达式的下钻路径：`a.b.c` → ["a","b","c"]；裸标识符 / 非成员 → null */
export type CalleeMemberPath = {
  /** 下钻路径（`a.b.c` → ["a","b","c"]） */
  segments: string[];
  /** 接收者（最左标识符）位置：1-based 行 / 0-based 列 */
  receiverLine: number;
  receiverCol: number;
};

/**
 * 被调者的成员路径（`obj.method` / `a.b.c`）；裸标识符 → null。
 * 计算属性（`obj["m"]`）只认**字面量键**；动态键（`obj[k]`）不可静态下钻。
 */
export function calleeMemberPath(callee: Node | null | undefined): CalleeMemberPath | null {
  if (!callee) return null;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") {
    return null;
  }
  const segments: string[] = [];
  let cur: Node = callee;
  for (;;) {
    if (cur.type === "Identifier") {
      segments.unshift(cur.name);
      const loc = cur.loc;
      if (!loc) return null;
      return { segments, receiverLine: loc.start.line, receiverCol: loc.start.column };
    }
    if (cur.type !== "MemberExpression" && cur.type !== "OptionalMemberExpression") return null;
    const key = memberKeyOf(cur);
    if (key === undefined) return null;
    segments.unshift(key);
    cur = (cur as unknown as { object: Node }).object;
  }
}

/** 被调者的展示名：裸标识符 → 名字；成员 → `a.b.c`；其余 → undefined */
export function calleeDisplayName(callee: Node | null | undefined): string | undefined {
  if (!callee) return undefined;
  if (callee.type === "Identifier") return callee.name;
  const path = calleeMemberPath(callee);
  return path ? path.segments.join(".") : undefined;
}

/** 成员表达式的键（字面量键；动态键 → undefined） */
function memberKeyOf(node: Node): string | undefined {
  const m = node as unknown as {
    computed?: boolean;
    property?: { type?: string; name?: string; value?: unknown };
  };
  const prop = m.property;
  if (!prop) return undefined;
  if (m.computed === true) {
    if (prop.type === "StringLiteral") return String(prop.value);
    if (prop.type === "NumericLiteral") return String(prop.value);
    return undefined;
  }
  if (prop.type === "Identifier") return prop.name;
  return undefined;
}

/** 形参位渲染：`name: type`（rest / optional 标记保留；无类型 → any） */
function renderParamLabel(name: string, t: Abs | undefined): string {
  const typeText = t ? formatShape(t) : "any";
  if (name.startsWith("...")) return `...${name.slice(3)}: ${typeText}`;
  if (name.endsWith("?")) return `${name.slice(0, -1)}?: ${typeText}`;
  return `${name}: ${typeText}`;
}

/** 收尾：拼 SignatureInformation / SignatureHelp 并**夹住** activeParameter */
function finishSignatureHelp(
  paramLabels: string[],
  retText: string,
  activeParam: number,
  docText: string,
): SignatureHelp {
  // 协议取值域：activeParameter 必须落在签名参数表内（越界 → 客户端回落 0
  // ⇒ 高亮错误的参数）；参数表为空 ⇒ 省略该字段。
  const active =
    paramLabels.length === 0
      ? undefined
      : Math.max(0, Math.min(activeParam, paramLabels.length - 1));
  const sig: SignatureInformation = {
    label: `(${paramLabels.join(", ")}) => ${retText}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: "```nudo\n" + docText + "\n```",
    },
    parameters: paramLabels.map((label) => ({ label })),
    ...(active !== undefined ? { activeParameter: active } : {}),
  };
  return {
    signatures: [sig],
    activeSignature: 0,
    ...(active !== undefined ? { activeParameter: active } : {}),
  };
}
