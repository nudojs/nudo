/**
 * realpath 归一（**身份键**口径：resolve → realpath，失败两级回落）。
 *
 * 历史：≥6 处微拷贝、两种口径（`resolve`+`realpath` 回落 `resolve(p)` vs
 * 裸 `realpath(p)` 回落原样）——相对路径调用时同一文件产出**不同归一键**
 * ⇒ 缓存键 / 模块归因 / symlink scope 判定之间的身份比较落空。
 *
 * 回落两级：目标不存在（草稿/侧车新建）时 realpath 其**目录**拼回 basename
 * （目录在 symlink 后面时仍得真实身份）；目录也读不到才回落 resolve 结果。
 * 注意：本函数是身份键，**不是** fail-closed 指纹路径——读错误折回落
 * 与既定 `readerr:` 口径（LoadDepsFingerprint）无关。
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function normalizeRealPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    try {
      return join(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}
