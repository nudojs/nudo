/**
 * A6：把侧车里 fn/param 上的数值谓词放宽为基类型（保守文本改写）。
 * 只在目标 fn 导出绑定附近改写，避免污染其它导出。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripNumericPreds(text: string): string {
  return text
    .replace(/\.(gt|ge|lt|le|min|max|positive|negative)\s*\([^)]*\)/g, "")
    .replace(/\.int\s*\(\s*\)/g, "")
    .replace(/\.int\b/g, "");
}

/** 定位 `export const <fn> = … fn( … )` / `<fn> = fn( … )` 的平衡括号区域 */
function replaceInFnRegion(
  src: string,
  fnName: string,
  replacer: (region: string) => string | undefined,
): string | undefined {
  const fn = escapeRegExp(fnName);
  const startRe = new RegExp(
    `(?:export\\s+const\\s+${fn}\\s*=\\s*|(?<![\\w$])${fn}\\s*=\\s*)fn\\s*\\(`,
  );
  const m = src.match(startRe);
  if (!m || m.index === undefined) return undefined;
  const start = m.index;
  const open = start + m[0].lastIndexOf("(");
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
    return region.split(constraintText).join(base);
  };
  const tryParam = (region: string): string | undefined => {
    if (!param) return undefined;
    const re = new RegExp(
      `(\\b${escapeRegExp(param)}\\s*:\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
      "g",
    );
    const next = region.replace(re, (_m, p1) => `${p1}number()`);
    return next !== region ? next : undefined;
  };
  const tryFn = (region: string): string | undefined => {
    const re = new RegExp(
      `(\\b${escapeRegExp(fnName)}\\s*=\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
      "g",
    );
    const next = region.replace(re, (_m, p1) => `${p1}number()`);
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

  for (const replacer of [tryText, tryParam, tryReturnSlot, tryFn]) {
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
