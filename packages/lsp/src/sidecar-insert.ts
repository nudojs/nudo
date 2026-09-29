/**
 * A6 missing-field quickfix：在目标 fn 的 `fn(` 调用括号内定位契约 `{`。
 * 纯函数（便于测试）：共享 shape / 跨 export 时返回 null，避免误改。
 *
 * 所有结构定位（`export const`、`fn(`、括号深度）只在**代码区**进行——
 * 字符串/注释里的同形文本会把插入点指进字符串或错误递减 braceDepth。
 */

import { maskCommentsAndStrings } from "@nudojs/core/internal";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type SidecarInsertPos = { line: number; character: number };

/**
 * 在侧车源码中定位 `export const <fnName> … fn( … )` 的契约对象 `{` 之后。
 * 从目标绑定向后找第一个属于该绑定的字面 `fn(`；再跟踪调用括号深度。
 * 调用闭合仍无 `{`（共享 shape / 标识符实参）→ null。
 */
export function findFnContractInsertPos(
  sidecarLines: string[],
  fnName: string,
): SidecarInsertPos | null {
  // 等长掩码：注释/字符串整段变空格（保留 \n），下标与原文一一对应
  const mask = maskCommentsAndStrings(sidecarLines.join("\n")).split("\n");

  // JS 标识符含 `$`：边界用 lookaround，不用 `\b`（否则 `foo$` 绑定匹配不上）
  const exportRe = new RegExp(
    `export\\s+const\\s+(?<![\\w$])${escapeRegExp(fnName)}(?![\\w$])`,
  );
  const fnLineIdx = mask.findIndex((l) => exportRe.test(l));
  if (fnLineIdx < 0) return null;

  let startLine = -1;
  let startCol = -1; // 指向 `fn(` 的 `(`
  for (let i = fnLineIdx; i < mask.length; i++) {
    // 已进入下一 export 绑定仍未找到 fn( → 不属于目标
    if (i > fnLineIdx && /\bexport\s+(?:const|let|var|function|default)\b/.test(mask[i]!)) {
      break;
    }
    const line = mask[i]!;
    const col = line.indexOf("fn(");
    if (col >= 0) {
      // 导出行上：只接受绑定名之后的 fn(
      if (i === fnLineIdx) {
        const nameCol = line.search(exportRe);
        if (nameCol >= 0 && col < nameCol) continue;
      }
      startLine = i;
      startCol = col + 2;
      break;
    }
  }
  if (startLine < 0) return null;

  let callDepth = 0;
  let braceDepth = 0;
  for (let i = startLine; i < mask.length; i++) {
    const t = mask[i]!;
    const col0 = i === startLine ? startCol : 0;
    for (let col = col0; col < t.length; col++) {
      const ch = t[col]!;
      if (ch === "(") {
        callDepth++;
      } else if (ch === ")") {
        callDepth--;
        if (callDepth <= 0) return null; // fn(…) 闭合且无契约 {
      } else if (ch === "{") {
        if (callDepth >= 1 && braceDepth === 0) {
          return { line: i, character: col + 1 };
        }
        braceDepth++;
      } else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
    if (i > startLine && callDepth <= 0) return null;
  }
  return null;
}
