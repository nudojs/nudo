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

/**
 * 全程走串回调版（走串扫描器族的共享骨架本体）：字符串感知（`\` 不是转义
 * ——与 splitTopLevelArgs / findTopLevelChar 同口径）+ 括号全量配平
 * （`( [ {` 各自计数）。`onChar` 对**每个非字符串内字符**调用（含括号字符
 * 本身；`depth` 为该字符处理**之后**的当前深度，括号开/闭已计入）；返回
 * `true` ⇒ 提前终止，`false` ⇒ 继续扫。
 *
 * `findTopLevelChar` 是其「跳过括号字符、pred 命中即返回下标」的薄壳；
 * 需要全程扫描记最大深度 / 首末括号配平 / 无深度诉求的纯字符串感知探测
 * （parser 指令面）直接消费本函数，不再手抄骨架。
 */
export function walkTopLevelChars(
  s: string,
  onChar: (ch: string, i: number, depth: number) => boolean,
): void {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
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
      if (onChar(ch, i, depth)) return;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (onChar(ch, i, depth)) return;
      continue;
    }
    if (onChar(ch, i, depth)) return;
  }
}

/**
 * 顶层字符匹配下标（字符串感知走串 + 括号配平；`\` 不是转义——与 case 实参
 * 原样 slice 一致）。pred 命中（返回 true）⇒ 返回该下标；无命中 → -1。
 * depth 为当前括号深度（pred 自行判 `depth === 0` 才算顶层）。**括号字符
 * 本身不进 pred**（开/闭只改深度）——走串骨架本体在 `walkTopLevelChars`，
 * 本函数是其薄壳（colon / 空格分隔等此前多处手抄同骨架）。
 */
export function findTopLevelChar(
  s: string,
  pred: (ch: string, i: number, depth: number) => boolean,
): number {
  let hit = -1;
  walkTopLevelChars(s, (ch, i, depth) => {
    // 括号字符不进 pred（与骨架化之前的原实现逐字一致）
    if (ch === "(" || ch === "[" || ch === "{" || ch === ")" || ch === "]" || ch === "}") {
      return false;
    }
    if (pred(ch, i, depth)) {
      hit = i;
      return true;
    }
    return false;
  });
  return hit;
}

/** 顶层冒号下标（字符串感知；`\` 不是转义）；无 → -1。 */
export function findTopLevelColon(s: string): number {
  return findTopLevelChar(s, (ch, _i, depth) => ch === ":" && depth === 0);
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
