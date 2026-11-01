import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/**
 * tmp + rename 原子写（同目录 temp ⇒ 崩溃/磁盘满时目标要么旧要么新，不会
 * 半截）。随机后缀用 `randomBytes`（不是 `Math.random`/`Date.now`）：防可
 * 预测 tmp 路径被预置符号链接劫持。
 *
 * 写/rename 失败 ⇒ 尽力清理孤儿 tmp 后 **rethrow**——吞错与否由调用方
 * 决定（缓存类调用方自行 try/catch 走 fail-open，侧车类必须让写失败
 * 冒泡）。
 *
 * 单一真源：此前 6 处手抄同一骨架（lsp `agent-tools` / nudojs
 * `contract-emit`、`migrate` / service `emit/interface-emitter`、
 * `emit/interface-derivation-emit`、`disk-cache`），tmp 后缀三种口径
 * （`Math.random` / `randomBytes` / `Date.now`）靠注释互称「同口径」。
 */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, data, "utf-8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort tmp cleanup */
    }
    throw e;
  }
}
