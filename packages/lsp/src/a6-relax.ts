/**
 * A6：把侧车里 fn/param 上的数值谓词放宽为基类型（保守文本改写）。
 * 只在目标 fn 导出绑定附近改写，避免污染其它导出。
 *
 * BUG-135：`nudo:unproven-return` 的 relax 动作**承诺**「放宽到推断面」⇒
 * 落盘必须是**推断面**（`any()` / 推断面基类型），不是 `stripNumericPreds`
 * 的副产品（基类型 `number()`——那既不是推断面、也消不掉诊断）。
 * ⇒ 新增 {@link relaxSidecarReturnToSurface}：把 `fn(…, <返回槽>)` 的
 * **第二个顶层实参**整体改写成给定的约束文本。
 */
import { matchSidecarFnDecl } from "@nudojs/service/emit";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripNumericPreds(text: string): string {
  return text
    .replace(/\.(gt|ge|lt|le|min|max|positive|negative)\s*\([^)]*\)/g, "")
    .replace(/\.int\s*\(\s*\)/g, "")
    .replace(/\.int\b/g, "");
}

/** 只剥数值谓词，保留 optional/lit 等结构方法 */
function stripNumericPredsKeepStructural(chain: string): string {
  return chain
    .replace(/\.(gt|ge|lt|le|min|max|positive|negative)\s*\([^)]*\)/g, "")
    .replace(/\.int\s*\(\s*\)/g, "")
    .replace(/\.int\b/g, "");
}

/** 定位 `export const <fn> = … fn( … )` / `<fn> = fn( … )` 的平衡括号区域。
 *  DESIGN-003：定位键=导出名身份（别名段 `const _nudo_1 = fn(…); export
 *  { _nudo_1 as class }` 经 matchSidecarFnDecl 解析绑定）。 */
function replaceInFnRegion(
  src: string,
  fnName: string,
  replacer: (region: string) => string | undefined,
): string | undefined {
  const located = matchSidecarFnDecl(src, fnName);
  if (located === undefined) return undefined;
  const start = located.start;
  const open = located.openParen;
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return undefined;
  let stop = end + 1;
  if (src[stop] === ";") stop++;
  const region = src.slice(start, stop);
  const nextRegion = replacer(region);
  if (nextRegion === undefined || nextRegion === region) return undefined;
  return src.slice(0, start) + nextRegion + src.slice(stop);
}

export function relaxSidecarConstraint(
  sidecarSource: string,
  fnName: string,
  param?: string,
  constraintText?: string,
): string | undefined {
  const tryText = (region: string): string | undefined => {
    if (!constraintText || !region.includes(constraintText)) return undefined;
    const base = stripNumericPreds(constraintText);
    if (!base || base === constraintText) return undefined;
    // 只改首次出现：同 fn 区域内 param/return 同文时，避免把 return 一并放宽
    return region.replace(constraintText, base);
  };
  const tryParam = (region: string): string | undefined => {
    if (!param) return undefined;
    const re = new RegExp(
      `((?<![\\w$])${escapeRegExp(param)}(?![\\w$])\\s*:\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
      "g",
    );
    const next = region.replace(re, (_m, p1, chain: string) => {
      const stripped = stripNumericPredsKeepStructural(chain);
      return `${p1}number${stripped}`;
    });
    return next !== region ? next : undefined;
  };
  const tryFn = (region: string): string | undefined => {
    const re = new RegExp(
      `((?<![\\w$])${escapeRegExp(fnName)}(?![\\w$])\\s*=\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
      "g",
    );
    const next = region.replace(re, (_m, p1, chain: string) => {
      const stripped = stripNumericPredsKeepStructural(chain);
      return `${p1}number${stripped}`;
    });
    return next !== region ? next : undefined;
  };

  const tryReturnSlot = (region: string): string | undefined => {
    // 返回槽：fn({ ... }, number().gt(40)) 的第二顶层实参
    const re = /(fn\s*\(\s*\{[\s\S]*?\}\s*,\s*)(number(?:\(\)(?:\.[A-Za-z]+(?:\([^)]*\))?)*)+)/;
    if (!re.test(region)) return undefined;
    const next = region.replace(re, (_m, prefix, slot) => {
      const base = stripNumericPreds(slot);
      return base && base !== slot ? `${prefix}${base}` : _m;
    });
    return next !== region ? next : undefined;
  };

  // 精确定位优先于裸文本首次替换，避免 return 槽 / 同文契约改错位
  for (const replacer of [tryParam, tryReturnSlot, tryFn, tryText]) {
    const next = replaceInFnRegion(sidecarSource, fnName, replacer);
    if (next !== undefined) return next;
  }
  // 无 fn 区域时：constraintText 在全文唯一才做首次替换（P1：多 export
  // 共用同文约束时全局替换会放宽错误导出）
  if (constraintText && sidecarSource.includes(constraintText)) {
    const first = sidecarSource.indexOf(constraintText);
    const second = sidecarSource.indexOf(constraintText, first + constraintText.length);
    if (second === -1) {
      const base = stripNumericPreds(constraintText);
      if (base && base !== constraintText) {
        return sidecarSource.replace(constraintText, base);
      }
    }
  }
  return undefined;
}

/**
 * `fn( … )` 调用的**顶层实参**切分（平衡括号 + 字符串/注释感知）。
 *
 * 返回槽 = **第二个**顶层实参（`fn({ … }, <返回槽>)`）；实参不足两个 ⇒
 * undefined（没有返回槽可改写）。
 *
 * 字符串字面量（含模板串）与注释里的括号/逗号不是定界符——侧车 DSL 里
 * `lit("a,b")` 这类字面量必须整段跳过，否则实参切分会切错。
 */
function fnCallArgs(
  region: string,
): { start: number; end: number }[] | undefined {
  const m = /fn\s*\(/.exec(region);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  const args: { start: number; end: number }[] = [];
  let depth = 0;
  let argStart = open + 1;
  let quote: '"' | "'" | "`" | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < region.length; i++) {
    const ch = region[i]!;
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && region[i + 1] === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "/" && region[i + 1] === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && region[i + 1] === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        args.push({ start: argStart, end: i });
        return args;
      }
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push({ start: argStart, end: i });
      argStart = i + 1;
    }
  }
  return undefined;
}

/**
 * BUG-135：把侧车里目标 fn 的**返回槽**（`fn({ … }, <返回槽>)` 的第二个顶层
 * 实参）改写成给定的约束文本（推断面）。
 *
 * 与 {@link relaxSidecarConstraint} 的区别：后者只**剥数值谓词**（产出基类型
 * `number()`——既不是推断面、也消不掉 `nudo:unproven-return`）；本函数按
 * **调用方给的推断面文本**整体替换返回槽（`any()` / `number()` / …）。
 *
 * 找不到返回槽（`fn({ … })` 无返回实参 / 目标 fn 不在侧车里）⇒ undefined
 * ⇒ 调用方不下发动作（宁可没有建议，也不给一个写坏侧车的编辑）。
 */
export function relaxSidecarReturnToSurface(
  sidecarSource: string,
  fnName: string,
  surfaceText: string,
): string | undefined {
  if (!surfaceText) return undefined;
  return replaceInFnRegion(sidecarSource, fnName, (region) => {
    const args = fnCallArgs(region);
    if (!args || args.length < 2) return undefined;
    const slot = args[1]!;
    const current = region.slice(slot.start, slot.end);
    // 空白槽（`fn({}, )` 非法写法）⇒ 没有返回槽可放宽
    if (current.trim() === "") return undefined;
    // 只替换**非空白**内芯：逗号后的缩进/空格原样保留
    // （否则 `fn({}, any())` 会被写成 `fn({},any())`）
    const lead = /^\s*/.exec(current)![0].length;
    const trail = /\s*$/.exec(current)![0].length;
    const start = slot.start + lead;
    const end = slot.end - trail;
    if (region.slice(start, end) === surfaceText) return undefined;
    return region.slice(0, start) + surfaceText + region.slice(end);
  });
}
