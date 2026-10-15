/**
 * 终端着色（dx-color）：只给 severity 标记与段落头着色，正文素色。
 *
 * 约定（对齐 NO_COLOR / FORCE_COLOR 业界惯例）：
 * - `NO_COLOR` 任意值 → 一律禁用（优先级最高）
 * - `FORCE_COLOR=1`（非 "0"）→ 强制启用（CI 截图 / 测试）
 * - 默认跟随 `stdout.isTTY`（管道/重定向自动无色，钉串与 JSON 面不受影响）
 *
 * 着色发生在 CLI 打印出口（formatCheckReport / formatTestReport 等纯文本
 * 产物外层），不进格式化函数本体——core/LSP 消费同一格式化器仍拿素色文本。
 */

const enabled: boolean =
  !process.env.NO_COLOR &&
  ((!!process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") || !!process.stdout.isTTY);

const RED = enabled ? "\x1b[31m" : "";
const GREEN = enabled ? "\x1b[32m" : "";
const YELLOW = enabled ? "\x1b[33m" : "";
const BOLD = enabled ? "\x1b[1m" : "";
const RESET = enabled ? "\x1b[0m" : "";

/** 段落头（signatures/issues/docs/budget/assertions/diagnostics） */
const HEADER_RE = /^(signatures|issues|docs|budget|assertions|diagnostics)$/;

function paintLine(line: string): string {
  if (!enabled) return line;
  if (
    /^\s*\[(error|ERROR)/.test(line) ||
    /^(FAILED|error:)/.test(line) ||
    /^\s*✗/.test(line) ||
    /— syntax error:/.test(line)
  ) {
    return RED + line + RESET;
  }
  if (/^\s*\[(warning|WARNING)/.test(line) || /^warning:/.test(line) || /^\s*⚠/.test(line)) {
    return YELLOW + line + RESET;
  }
  if (/^OK$/.test(line) || /^\s*✓/.test(line)) {
    return GREEN + line + RESET;
  }
  if (HEADER_RE.test(line)) {
    return BOLD + line + RESET;
  }
  return line;
}

/** 多行文本行级着色（无色模式恒等返回）。 */
export function paint(text: string): string {
  if (!enabled) return text;
  return text.split("\n").map(paintLine).join("\n");
}

/** 单行着色（diagnostics 循环等逐行打印点）。 */
export function paintOne(line: string): string {
  return paintLine(line);
}
