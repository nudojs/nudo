/**
 * Template string 拼接（代数侧）。
 * 表示：prim(string) + refinement.meta.templateParts = Abs[]
 * 与 core 的 createTemplate 对齐，使 `"x" + string + "!"` 得到 template refined。
 *
 * 本模块是模板语义的唯一真理源：前缀/后缀/固定文本/长度/匹配/名称渲染/
 * 相邻合并/谓词判定等纯计算以「中性 part 视图」（TemplatePartView）暴露；
 * Abs 方法表（methods.ts）只做薄适配。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue } from "./abs.ts";
import { lit, termToString, type Term } from "./term.ts";
import { pTrue, type Pred } from "./pred.ts";

export type TemplateMeta = {
  templateParts: Abs[];
};

// --- 中性 part 视图：方法表共享的语义计算 ---

/** 单个 part 的分类：固定文本，或抽象 part（携带展示文本） */
export type TemplatePartDesc = { fixed: string } | { render: string };

/** 带原始 part 回引的视图：既喂语义计算，也用于重建合并结果 */
export type TemplatePartView<P = unknown> = {
  /** 固定文本；undefined = 抽象 part */
  fixed: string | undefined;
  /** 抽象 part 的展示文本（渲染 `${...}` 名时使用） */
  render: string;
  part: P;
};

export function viewTemplateParts<P>(
  parts: P[],
  describe: (p: P) => TemplatePartDesc,
): TemplatePartView<P>[] {
  return parts.map((p) => {
    const d = describe(p);
    return "fixed" in d
      ? { fixed: d.fixed, render: d.fixed, part: p }
      : { fixed: undefined, render: d.render, part: p };
  });
}

/** 前导固定文本（遇到首个抽象 part 停止） */
export function knownPrefixOfViews(views: TemplatePartView[]): string {
  let s = "";
  for (const v of views) {
    if (v.fixed !== undefined) s += v.fixed;
    else break;
  }
  return s;
}

/** 尾部固定文本（从末尾遇到首个抽象 part 停止） */
export function knownSuffixOfViews(views: TemplatePartView[]): string {
  let s = "";
  for (let i = views.length - 1; i >= 0; i--) {
    const v = views[i]!;
    if (v.fixed !== undefined) s = v.fixed + s;
    else break;
  }
  return s;
}

/** 全部固定文本按序拼接（跨抽象 part） */
export function allFixedTextOfViews(views: TemplatePartView[]): string {
  return views
    .filter((v) => v.fixed !== undefined)
    .map((v) => v.fixed!)
    .join("");
}

/** 全部 part 均为固定文本时的精确总长；含抽象 part 则 undefined */
export function fixedLengthOfViews(views: TemplatePartView[]): number | undefined {
  if (views.some((v) => v.fixed === undefined)) return undefined;
  return allFixedTextOfViews(views).length;
}

/** 渲染 `` `lit${render}` `` 形态的模板名 */
export function formatTemplateNameViews(views: TemplatePartView[]): string {
  const inner = views
    .map((v) => (v.fixed !== undefined ? v.fixed : `\${${v.render}}`))
    .join("");
  return `\`${inner}\``;
}

/** 相邻固定文本合并；rebuildFixed 以合并文本重建视图（含原始 part） */
export function mergeAdjacentFixedViews<P>(
  views: TemplatePartView<P>[],
  rebuildFixed: (text: string) => TemplatePartView<P>,
): TemplatePartView<P>[] {
  const out: TemplatePartView<P>[] = [];
  for (const v of views) {
    const last = out[out.length - 1];
    if (last && last.fixed !== undefined && v.fixed !== undefined) {
      out[out.length - 1] = rebuildFixed(last.fixed + v.fixed);
    } else {
      out.push(v);
    }
  }
  return out;
}

/** 具体字符串是否匹配模板（Refinement.check 的判定语义） */
export function templateMatchesValue(value: string, views: TemplatePartView[]): boolean {
  let pos = 0;
  for (let i = 0; i < views.length; i++) {
    const v = views[i]!;
    if (v.fixed !== undefined) {
      if (!value.startsWith(v.fixed, pos)) return false;
      pos += v.fixed.length;
    } else {
      if (i === views.length - 1) return true;
      const next = views[i + 1];
      if (next?.fixed !== undefined) {
        const idx = value.indexOf(next.fixed, pos);
        if (idx === -1) return false;
        pos = idx;
      } else {
        return true;
      }
    }
  }
  return pos === value.length;
}

// --- 谓词判定：startsWith / endsWith / includes ---

/** 三值判定；Abs 方法表把 "unknown" 适配为 boolPrim */
export type TemplatePredicateDecision = boolean | "unknown";

export function decideStartsWith(prefix: string, search: string): TemplatePredicateDecision {
  if (prefix.length >= search.length) return prefix.startsWith(search);
  if (search.startsWith(prefix)) return "unknown";
  return false;
}

export function decideEndsWith(suffix: string, search: string): TemplatePredicateDecision {
  if (suffix.length >= search.length) return suffix.endsWith(search);
  if (search.endsWith(suffix)) return "unknown";
  return false;
}

export function decideIncludes(fixedText: string, search: string): TemplatePredicateDecision {
  return fixedText.includes(search) ? true : "unknown";
}

// --- Abs 侧适配 ---

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

function describeAbsPart(p: Abs): TemplatePartDesc {
  if (isStrLit(p)) return { fixed: String(litValue(p)) };
  return { render: p.term ? termToString(p.term) : "string" };
}

export function absTemplateViews(parts: Abs[]): TemplatePartView<Abs>[] {
  return viewTemplateParts(parts, describeAbsPart);
}

/** 从 Abs 提取 template parts（已是 template 则展开，否则 [self]） */
export function templatePartsOf(a: Abs): Abs[] {
  if (isTemplateAbs(a)) {
    const meta = (a.pred as unknown as { meta: TemplateMeta }).meta;
    return meta.templateParts;
  }
  return [a];
}

function rebuildAbsFixedView(text: string): TemplatePartView<Abs> {
  return {
    fixed: text,
    render: text,
    part: abs({ k: "prim", type: "string" }, lit(text), undefined, "exact"),
  };
}

/**
 * 合并相邻字面量；纯字面量折叠为 lit；单 string prim → prim。
 */
function normalizeParts(parts: Abs[]): Abs[] {
  return mergeAdjacentFixedViews(absTemplateViews(parts), rebuildAbsFixedView).map((v) => v.part);
}

function formatTemplateName(parts: Abs[]): string {
  return formatTemplateNameViews(absTemplateViews(parts));
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
