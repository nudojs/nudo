/**
 * Template string 拼接（kernel 侧）。
 * 表示：prim(string) + refinement.meta.templateParts = Abs[]
 * 与 core 的 createTemplate 对齐，使 `"x" + string + "!"` 得到 template refined。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue } from "./abs.ts";
import { lit, termToString, type Term } from "./term.ts";
import { pTrue, type Pred } from "./pred.ts";

export type TemplateMeta = {
  templateParts: Abs[];
};

function isStrLit(a: Abs): a is Abs & { term: { op: "lit"; value: string } } {
  return (
    a.shape.k === "prim" &&
    a.shape.type === "string" &&
    a.term?.op === "lit" &&
    typeof a.term.value === "string"
  );
}

function isStrPrim(a: Abs): boolean {
  return a.shape.k === "prim" && a.shape.type === "string";
}

function isTemplateAbs(a: Abs): boolean {
  return (
    a.shape.k === "prim" &&
    a.shape.type === "string" &&
    !!a.pred &&
    (a.pred as { name?: string }).name?.startsWith("`") === true &&
    Array.isArray(((a.pred as { meta?: TemplateMeta }).meta)?.templateParts)
  );
}

/** 从 Abs 提取 template parts（已是 template 则展开，否则 [self]） */
export function templatePartsOf(a: Abs): Abs[] {
  if (isTemplateAbs(a)) {
    const meta = (a.pred as { meta: TemplateMeta }).meta;
    return meta.templateParts;
  }
  return [a];
}

/**
 * 合并相邻字面量；纯字面量折叠为 lit；单 string prim → prim。
 */
function normalizeParts(parts: Abs[]): Abs[] {
  const out: Abs[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && isStrLit(last) && isStrLit(p)) {
      out[out.length - 1] = abs(
        { k: "prim", type: "string" },
        lit(String(litValue(last)) + String(litValue(p))),
        undefined,
        "exact",
      );
    } else {
      out.push(p);
    }
  }
  return out;
}

function formatTemplateName(parts: Abs[]): string {
  const inner = parts
    .map((p) => {
      if (isStrLit(p)) return String(litValue(p));
      return `\${${p.term ? termToString(p.term) : "string"}}`;
    })
    .join("");
  return `\`${inner}\``;
}

/**
 * 构造 template Abs。
 * - 全字面量 → exact lit
 * - 单 string prim → prim
 * - 否则 prim(string) + pred(name=template, meta.templateParts)
 */
export function createTemplateAbs(parts: Abs[]): Abs {
  const normalized = normalizeParts(parts);
  if (normalized.length === 1) {
    const only = normalized[0]!;
    if (isStrLit(only)) return only;
    if (isStrPrim(only) && !isTemplateAbs(only)) return only;
  }
  const name = formatTemplateName(normalized);
  // abs() 会丢弃 op==="true" 的 pred；直接构造以保留 template meta
  const predObj = {
    op: "true",
    name,
    meta: { templateParts: normalized } satisfies TemplateMeta,
  } as unknown as Pred;

  return {
    shape: { k: "prim", type: "string" },
    term: undefined,
    pred: predObj,
    conf: "path",
  };
}

export function isTemplateLike(a: Abs): boolean {
  return isTemplateAbs(a);
}

/** 字符串拼接：字面量折叠 + template parts 合并 */
export function concatString(a: Abs, b: Abs): Abs {
  // 双字面量
  if (isStrLit(a) && isStrLit(b)) {
    return abs(
      { k: "prim", type: "string" },
      lit(String(litValue(a)) + String(litValue(b))),
      undefined,
      "exact",
    );
  }
  // 至少一侧是 string（含 template / prim / 可 stringify 字面量）
  const aParts = coerceToStringParts(a);
  const bParts = coerceToStringParts(b);
  if (!aParts || !bParts) return abs({ k: "unknown" }, undefined, undefined, "partial");
  return createTemplateAbs([...aParts, ...bParts]);
}

function coerceToStringParts(a: Abs): Abs[] | undefined {
  if (isTemplateAbs(a) || isStrPrim(a)) return templatePartsOf(a);
  if (isStrLit(a)) return [a];
  // 数值/布尔字面量：JS ToPrimitive 拼接
  const lv = litValue(a);
  if (typeof lv === "number" || typeof lv === "boolean") {
    return [abs({ k: "prim", type: "string" }, lit(String(lv)), undefined, "exact")];
  }
  if (a.shape.k === "prim" && a.shape.type === "number") {
    // abstract number → `${number}` part
    return [a];
  }
  return undefined;
}
