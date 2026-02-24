import type { TypeValue } from "@nudojs/core";
import { typeValueToString } from "@nudojs/core";
import type { AnalysisResult } from "./analyzer.ts";

export function typeValueToTSType(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      const v = tv.value;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "boolean") return String(v);
      return String(v);
    }
    case "primitive":
      return tv.type;
    case "object": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return "{}";
      const inner = entries
        .map(([k, v]) => `${k}: ${typeValueToTSType(v)}`)
        .join("; ");
      return `{ ${inner} }`;
    }
    case "array":
      return `${wrapComplexType(tv.element)}[]`;
    case "tuple": {
      const inner = tv.elements.map(typeValueToTSType).join(", ");
      return `[${inner}]`;
    }
    case "function": {
      const params = tv.params
        .map((p, i) => `${p}: unknown`)
        .join(", ");
      return `(${params}) => unknown`;
    }
    case "promise":
      return `Promise<${typeValueToTSType(tv.value)}>`;
    case "instance":
      return tv.className;
    case "union":
      return tv.members.map(typeValueToTSType).join(" | ");
    case "never":
      return "never";
    case "unknown":
      return "unknown";
  }
}

function wrapComplexType(tv: TypeValue): string {
  const ts = typeValueToTSType(tv);
  if (tv.kind === "union") return `(${ts})`;
  return ts;
}

export function generateDts(result: AnalysisResult): string {
  const lines: string[] = [];

  for (const fn of result.functions) {
    if (fn.cases.length === 0 && fn.combined) {
      lines.push(`export declare function ${fn.name}(...args: unknown[]): ${typeValueToTSType(fn.combined)};`);
      continue;
    }

    if (fn.cases.length === 1) {
      const c = fn.cases[0];
      const params = c.args
        .map((a, i) => `arg${i}: ${typeValueToTSType(a)}`)
        .join(", ");
      const ret = typeValueToTSType(c.result);
      lines.push(`export declare function ${fn.name}(${params}): ${ret};`);
      continue;
    }

    for (const c of fn.cases) {
      const params = c.args
        .map((a, i) => `arg${i}: ${typeValueToTSType(a)}`)
        .join(", ");
      const ret = typeValueToTSType(c.result);
      lines.push(`export declare function ${fn.name}(${params}): ${ret};`);
    }
  }

  return lines.join("\n") + "\n";
}
