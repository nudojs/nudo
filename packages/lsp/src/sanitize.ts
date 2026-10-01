/**
 * 错误 message 脱敏（BUG-023 / S5-005）。
 * LSP 诊断 / agent 工具结果会进 IDE 与远端 LLM 会话——
 * 原始 err.message 常带绝对路径（模块解析、ENOENT），
 * 等于回传工作区布局。产品面只保留相对/占位形态；
 * 完整 detail 走 connection.console / 日志（本模块不负责）。
 */
import { homedir } from "node:os";

/**
 * 把 message 中的绝对路径换成占位：
 * - 家目录前缀 → `~`
 * - 调用方根（workspace / cwd）前缀 → `.`
 * 其余原文保留（脱敏是路径面过滤，不是内容审查）。
 */
export function sanitizeErrorMessage(
  message: string,
  roots: string[] = [process.cwd()],
): string {
  let out = message;
  // 根前缀先替（更具体），家目录后替（~ 兜底）
  for (const root of roots) {
    if (
      root &&
      root !== "/" &&
      root !== "." &&
      root !== "~" &&
      out.includes(root)
    ) {
      out = out.split(root).join(".");
    }
  }
  const home = homedir();
  if (home && home !== "/" && home !== "." && out.includes(home)) {
    out = out.split(home).join("~");
  }
  return out;
}
