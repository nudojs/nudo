/**
 * Abs / SchemaNode → Standard Schema v1 运行时模块（单向有损投影）。
 *
 * 产物是零第三方依赖的 TS/JS 模块：每个导出实现 `~standard` Props
 * （version=1, vendor="nudo", validate）。validate 对 SchemaNode 做
 * 结构 + 可表达 refinement 执法；落不了的 pred 不在此假装精确。
 *
 * 协议：https://standardschema.dev —— 运行时互操作出口，不替代 nudo check。
 */

import type { Abs } from "@nudojs/core";
import { absToSchemaNode, type SchemaNode } from "./schema-generator.ts";

export type StandardSchemaIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey>;
};

export type StandardSchemaResult =
  | { value: unknown; issues?: undefined }
  | { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined };

function pushIssue(
  issues: StandardSchemaIssue[],
  path: PropertyKey[],
  message: string,
): void {
  issues.push(path.length > 0 ? { message, path: [...path] } : { message });
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function checkPrimRefinements(
  refinements: ReadonlyArray<{ kind: string; op?: string; n?: number }>,
  value: unknown,
  path: PropertyKey[],
  issues: StandardSchemaIssue[],
): void {
  if (typeof value !== "number" && typeof value !== "string") return;
  for (const r of refinements) {
    if (r.kind === "int") {
      if (typeof value === "number" && !Number.isInteger(value)) {
        pushIssue(issues, path, "expected integer");
      }
      continue;
    }
    if (r.kind === "numBound" && typeof value === "number" && typeof r.n === "number") {
      const n = r.n;
      const op = r.op;
      let ok = true;
      if (op === "gt") ok = value > n;
      else if (op === "ge") ok = value >= n;
      else if (op === "lt") ok = value < n;
      else if (op === "le") ok = value <= n;
      if (!ok) pushIssue(issues, path, `expected number ${op} ${n}, got ${value}`);
      continue;
    }
    if (r.kind === "strMin" && typeof value === "string" && typeof r.n === "number") {
      if (value.length < r.n) {
        pushIssue(issues, path, `expected string length >= ${r.n}, got ${value.length}`);
      }
      continue;
    }
    if (r.kind === "strMax" && typeof value === "string" && typeof r.n === "number") {
      if (value.length > r.n) {
        pushIssue(issues, path, `expected string length <= ${r.n}, got ${value.length}`);
      }
    }
  }
}

function checkNode(
  node: SchemaNode,
  value: unknown,
  path: PropertyKey[],
  issues: StandardSchemaIssue[],
): void {
  switch (node.k) {
    case "unknown":
    case "fn":
    case "brand":
    case "promise":
      // Phase C：不执法这些形态（fn/brand 无可靠运行时判据；unknown 放行）
      return;
    case "never":
      pushIssue(issues, path, "expected never");
      return;
    case "lit": {
      const expected = node.value;
      const same =
        expected === value ||
        (typeof expected === "number" &&
          typeof value === "number" &&
          Number.isNaN(expected) &&
          Number.isNaN(value));
      if (!same) {
        pushIssue(issues, path, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
      }
      return;
    }
    case "prim": {
      const t = node.type;
      const actual = typeOf(value);
      const ok =
        (t === "number" && actual === "number") ||
        (t === "string" && actual === "string") ||
        (t === "boolean" && actual === "boolean") ||
        (t === "bigint" && actual === "bigint") ||
        (t === "symbol" && actual === "symbol");
      if (!ok) {
        pushIssue(issues, path, `expected ${t}, got ${actual}`);
        return;
      }
      checkPrimRefinements(node.refinements, value, path, issues);
      return;
    }
    case "obj": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        pushIssue(issues, path, `expected object, got ${typeOf(value)}`);
        return;
      }
      const rec = value as Record<string, unknown>;
      for (const slot of node.slots) {
        const key = slot.key;
        if (!(key in rec) || rec[key] === undefined) {
          if (!slot.optional) pushIssue(issues, [...path, key], "required");
          continue;
        }
        checkNode(slot.node, rec[key], [...path, key], issues);
      }
      return;
    }
    case "arr": {
      if (!Array.isArray(value)) {
        pushIssue(issues, path, `expected array, got ${typeOf(value)}`);
        return;
      }
      value.forEach((item, i) => {
        checkNode(node.element, item, [...path, i], issues);
      });
      return;
    }
    case "tuple": {
      if (!Array.isArray(value)) {
        pushIssue(issues, path, `expected tuple, got ${typeOf(value)}`);
        return;
      }
      node.elements.forEach((el, i) => {
        checkNode(el, value[i], [...path, i], issues);
      });
      return;
    }
    case "union": {
      for (const m of node.members) {
        const local: StandardSchemaIssue[] = [];
        checkNode(m, value, path, local);
        if (local.length === 0) return;
      }
      pushIssue(
        issues,
        path,
        `expected one of ${node.members.length} union members, got ${typeOf(value)}`,
      );
      return;
    }
    case "promise": {
      // 同步投影：不 unwrap thenable；仅当已是 resolved 形态时无从得知 —— 放行并注明
      return;
    }
    default:
      return;
  }
}

/** SchemaNode 同步校验（生成模块与测试共用语义）。 */
export function validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult {
  const issues: StandardSchemaIssue[] = [];
  checkNode(node, value, [], issues);
  return issues.length === 0 ? { value } : { issues };
}

/** 内联进生成模块的校验器源码（与 validateSchemaNode 同逻辑的紧凑版）。 */
const CHECK_FN_SOURCE = `
function __nudoTypeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function __nudoCheck(node, value, path, issues) {
  function push(msg) {
    issues.push(path.length > 0 ? { message: msg, path: path.slice() } : { message: msg });
  }
  switch (node.k) {
    case "unknown":
    case "summarized":
    case "fn":
    case "brand":
    case "promise":
      return;
    case "never":
      push("expected never");
      return;
    case "lit": {
      const expected = node.value;
      const same = expected === value ||
        (typeof expected === "number" && typeof value === "number" &&
          Number.isNaN(expected) && Number.isNaN(value));
      if (!same) push("expected " + JSON.stringify(expected) + ", got " + JSON.stringify(value));
      return;
    }
    case "prim": {
      const t = node.type;
      const actual = __nudoTypeOf(value);
      const ok =
        (t === "number" && actual === "number") ||
        (t === "string" && actual === "string") ||
        (t === "boolean" && actual === "boolean") ||
        (t === "bigint" && actual === "bigint") ||
        (t === "symbol" && actual === "symbol");
      if (!ok) { push("expected " + t + ", got " + actual); return; }
      for (const r of node.refinements || []) {
        if (r.kind === "int" && typeof value === "number" && !Number.isInteger(value)) {
          push("expected integer");
        } else if (r.kind === "numBound" && typeof value === "number" && typeof r.n === "number") {
          var okB = true;
          if (r.op === "gt") okB = value > r.n;
          else if (r.op === "ge") okB = value >= r.n;
          else if (r.op === "lt") okB = value < r.n;
          else if (r.op === "le") okB = value <= r.n;
          if (!okB) push("expected number " + r.op + " " + r.n + ", got " + value);
        } else if (r.kind === "strMin" && typeof value === "string" && typeof r.n === "number") {
          if (value.length < r.n) push("expected string length >= " + r.n + ", got " + value.length);
        } else if (r.kind === "strMax" && typeof value === "string" && typeof r.n === "number") {
          if (value.length > r.n) push("expected string length <= " + r.n + ", got " + value.length);
        }
      }
      return;
    }
    case "obj": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        push("expected object, got " + __nudoTypeOf(value));
        return;
      }
      for (const slot of node.slots) {
        const key = slot.key;
        if (!(key in value) || value[key] === undefined) {
          if (!slot.optional) { path.push(key); push("required"); path.pop(); }
          continue;
        }
        path.push(key);
        __nudoCheck(slot.node, value[key], path, issues);
        path.pop();
      }
      return;
    }
    case "arr": {
      if (!Array.isArray(value)) { push("expected array, got " + __nudoTypeOf(value)); return; }
      for (let i = 0; i < value.length; i++) {
        path.push(i);
        __nudoCheck(node.element, value[i], path, issues);
        path.pop();
      }
      return;
    }
    case "tuple": {
      if (!Array.isArray(value)) { push("expected tuple, got " + __nudoTypeOf(value)); return; }
      for (let i = 0; i < node.elements.length; i++) {
        path.push(i);
        __nudoCheck(node.elements[i], value[i], path, issues);
        path.pop();
      }
      return;
    }
    case "union": {
      for (const m of node.members) {
        const local = [];
        __nudoCheck(m, value, path, local);
        if (local.length === 0) return;
      }
      push("expected one of " + node.members.length + " union members, got " + __nudoTypeOf(value));
      return;
    }
    default:
      return;
  }
}
`.trim();

function makeStandardSchemaSource(exportName: string, node: SchemaNode, dropped: string[]): string {
  const json = JSON.stringify(node);
  const notes =
    dropped.length > 0
      ? dropped.map((d) => `//   ${d}`).join("\n") + "\n"
      : "";
  return `${notes}export const ${exportName} = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value) {
      const issues = [];
      __nudoCheck(${json}, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;`;
}

export type StandardSchemaModuleProjection = {
  source: string;
  dropped: string[];
};

/**
 * Abs → Standard Schema v1 模块源码。
 * `exports`：导出名 → Abs（通常是 output / 各参数）。
 */
export function absToStandardSchemaModule(
  exports: Record<string, Abs>,
  opts?: { banner?: string },
): StandardSchemaModuleProjection {
  const dropped: string[] = [];
  const bodies: string[] = [];
  for (const [name, abs] of Object.entries(exports)) {
    const { node, dropped: d } = absToSchemaNode(abs);
    dropped.push(...d.map((n) => `${name}: ${n}`));
    bodies.push(makeStandardSchemaSource(name, node, d.map((n) => `${name}: ${n}`)));
  }
  const banner =
    opts?.banner ??
    `// @generated by nudo export --format standard — Standard Schema v1 (vendor: nudo)\n// One-way lossy projection of Abs; do not edit. nudo check remains the gate.`;
  const source = `${banner}

${CHECK_FN_SOURCE}

${bodies.join("\n\n")}
`;
  return { source, dropped };
}

/** 便捷：单个 Abs → 单导出模块（默认导出名 `schema`）。 */
export function absToStandardSchema(
  a: Abs,
  opts?: { name?: string },
): StandardSchemaModuleProjection {
  return absToStandardSchemaModule({ [opts?.name ?? "schema"]: a });
}
