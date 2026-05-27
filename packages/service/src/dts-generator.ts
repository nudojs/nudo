import type { TypeValue } from "@nudojs/core";
import { typeValueToString, isTemplate, getTemplateParts } from "@nudojs/core";
import type { AnalysisResult, FunctionAnalysis } from "./analyzer.ts";

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
    case "refined": {
      if (isTemplate(tv)) {
        const parts = getTemplateParts(tv)!;
        const inner = parts
          .map((p) => (p.kind === "literal" && typeof p.value === "string" ? p.value : `\${${typeValueToTSType(p)}}`))
          .join("");
        return `\`${inner}\``;
      }
      return typeValueToTSType(tv.base);
    }
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
        .map((p) => `${p}: unknown`)
        .join(", ");
      const returnType = (tv as any)._returnType;
      const retStr = returnType ? typeValueToTSType(returnType) : "unknown";
      return `(${params}) => ${retStr}`;
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

function getParamName(fn: FunctionAnalysis, index: number): string {
  if (fn.paramNames && fn.paramNames[index]) {
    return fn.paramNames[index];
  }
  return `arg${index}`;
}

function generateJSDoc(fn: FunctionAnalysis): string {
  if (fn.cases.length === 0) return "";
  const lines: string[] = ["/**"];
  for (const c of fn.cases) {
    if (fn.cases.length > 1) {
      lines.push(` * Case: ${c.name}`);
    }
    for (let i = 0; i < c.args.length; i++) {
      const paramName = getParamName(fn, i);
      lines.push(` * @param ${paramName} - ${typeValueToTSType(c.args[i])}`);
    }
    lines.push(` * @returns ${typeValueToTSType(c.result)}`);
  }
  lines.push(" */");
  return lines.join("\n");
}

export function generateDts(result: AnalysisResult): string {
  const lines: string[] = [];

  for (const fn of result.functions) {
    const jsdoc = generateJSDoc(fn);

    if (fn.cases.length === 0 && fn.combined) {
      if (jsdoc) lines.push(jsdoc);
      lines.push(`export declare function ${fn.name}(...args: unknown[]): ${typeValueToTSType(fn.combined)};`);
      continue;
    }

    if (fn.cases.length === 1) {
      const c = fn.cases[0];
      const params = c.args
        .map((a, i) => `${getParamName(fn, i)}: ${typeValueToTSType(a)}`)
        .join(", ");
      const ret = typeValueToTSType(c.result);
      if (jsdoc) lines.push(jsdoc);
      lines.push(`export declare function ${fn.name}(${params}): ${ret};`);
      continue;
    }

    if (jsdoc) lines.push(jsdoc);
    for (const c of fn.cases) {
      const params = c.args
        .map((a, i) => `${getParamName(fn, i)}: ${typeValueToTSType(a)}`)
        .join(", ");
      const ret = typeValueToTSType(c.result);
      lines.push(`export declare function ${fn.name}(${params}): ${ret};`);
    }
  }

  return lines.join("\n") + "\n";
}
