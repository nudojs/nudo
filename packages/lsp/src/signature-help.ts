import { formatShape, type Abs } from "@nudojs/core";
import { MarkupKind, type SignatureHelp, type SignatureInformation } from "vscode-languageserver/node";

/**
 * Signature help 投影：fn Abs → LSP SignatureHelp。
 * 参数位用 formatShape 外延（paramTypes 缺失 → any；返回缺失 → unknown）。
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
    const t = paramTypes?.[i];
    const typeText = t ? formatShape(t) : "any";
    if (name.startsWith("...")) paramLabels.push(`...${name.slice(3)}: ${typeText}`);
    else if (name.endsWith("?")) paramLabels.push(`${name.slice(0, -1)}?: ${typeText}`);
    else paramLabels.push(`${name}: ${typeText}`);
  }
  const retText = shape.returnType ? formatShape(shape.returnType) : "unknown";
  const sig: SignatureInformation = {
    label: `(${paramLabels.join(", ")}) => ${retText}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: "```nudo\n" + formatShape(fnAbs) + "\n```",
    },
    parameters: paramLabels.map((label) => ({ label })),
    ...(activeParam >= 0 ? { activeParameter: activeParam } : {}),
  };
  return {
    signatures: [sig],
    activeSignature: 0,
    ...(activeParam >= 0 ? { activeParameter: activeParam } : {}),
  };
}
