/**
 * 字符串感知的顶层结构扫描（**单源**）。
 *
 * 消费面：core 的 check case 实参切分（`check-case-scan.ts`）与 parser 的
 * 指令表达式扫描（`expr-scan.ts` / `fn-directives.ts`）。此前两包各留一份
 * 逐字拷贝靠注释互钉——Bug 1009 正是这对拷贝漂移的事故（check 面曾把
 * `\` 当转义 ⇒ 实参少切一个 ⇒ L2 违例见证整条静默跳过 ⇒ 门禁假绿）。
 * 本模块是唯一实现：core 内部相对 import，parser 经 `@nudojs/core/internal`
 * 消费。
 *
 * 口径：引号内 `\` **不是**转义（原样 slice）⇒ `"a\", -1` 在 `"a\"` 处
 * 闭合 ⇒ 实参个数 = 2。转义感知的串字面量扫描是另一口径
 * （parser `string-literal.ts` 的 `scanStringLiteral`，刻意相反，见其头注释）。
 */

/** 顶层逗号切分（字符串感知；`\` 不是转义）。 */
export function splitTopLevelArgs(s: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      current += ch;
      // 原样 slice：`\` 不是转义
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/** 顶层冒号下标（字符串感知；`\` 不是转义）；无 → -1。 */
export function findTopLevelColon(s: string): number {
  let found = -1;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length && found < 0; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (ch === ":" && depth === 0) found = i;
  }
  return found;
}

/**
 * JSDoc 续行前缀（` * `）剥离——块注释内的多行指令实参每行仍带 ` * ` 前缀
 * （Bug 375：不剥 ⇒ 实参认不出 ⇒ 整条见证被静默跳过）。
 */
export function stripJsdocContinuation(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");
}
