/**
 * `export --out` 的**模块标识**（与绝对路径无关的稳定 id）。
 *
 * 写进产物 marker（`// nudo-export-module: <id>`），并作为「同一模块 ⇒ 原地
 * 覆盖」的判定键（BUG-016）；`--out` 落盘时说明符重基也要用它把「源文件」对上
 * 「已经落盘的兄弟声明」（BUG-103）。
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { localNamedExports } from "@nudojs/core";
import { parseJsonText } from "../../read-json.ts";

/** 最近的含 `package.json` 的祖先目录（无 ⇒ undefined）。 */
export function packageRootOf(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** 包名（`package.json#name`，读不到 / 非字符串 ⇒ undefined）。 */
export function packageNameOf(root: string): string | undefined {
  try {
    const pkg: unknown = parseJsonText(readFileSync(join(root, "package.json"), "utf-8"));
    if (pkg !== null && typeof pkg === "object") {
      const name = (pkg as { name?: unknown }).name;
      if (typeof name === "string" && name !== "") return name;
    }
  } catch {
    /* 读不到 / 解析失败 ⇒ 退回相对路径口径 */
  }
  return undefined;
}

/**
 * 模块标识（**与绝对路径无关**的稳定 id）——写进产物 marker，并作为
 * 「同一模块 ⇒ 原地覆盖」的判定键（BUG-016）。
 *
 * - 文件在**包根**（最近的含 `package.json` 的祖先目录）内 ⇒
 *   `<包名>/<相对包根的路径>`。同一份源码在不同 checkout / 不同机器上得到
 *   **同一个** id ⇒ 产物字节可复现，且不同文件仍得到不同 id；
 * - 包外（临时目录 / 单文件导出）⇒ `<父目录名>/<stem>|<导出名集合>`：同一份
 *   源码放在不同绝对路径下仍是**同一模块**（第二次导出原地覆盖，不再新增 hash
 *   后缀副本），导出名不同的同名文件仍是不同模块。改函数体不改导出名 ⇒ id
 *   不变 ⇒ 重导仍是原地覆盖（BUG-231）。
 *
 * 旧口径直接把**绝对源路径**当模块标识 ⇒ 「同一模块」挂在本机路径上：
 * 换目录重导 ⇒ 多一份陈旧副本，且产物内嵌构建机绝对路径。
 */
export function moduleIdOf(filePath: string, source: string): string {
  const root = packageRootOf(dirname(filePath));
  if (root !== undefined) {
    const name = packageNameOf(root);
    const rel = relative(root, filePath).split(sep).join("/");
    return name === undefined ? rel : `${name}/${rel}`;
  }
  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  const exports = [...localNamedExports(source)].sort().join(",");
  // BUG-049：包外键必须带**目录维度** —— 旧键只有 `stem|导出集合`，两个不同
  // 目录下的同名同导出模块得到同一个键 ⇒ `isSameModule` 判真 ⇒ 后导出的
  // 静默覆盖前者的全部四份产物（exit 0、零告警）。目录名进键即可区分常见的
  // 兄弟模块，且仍不含绝对路径（产物可复现）。
  const parent = basename(dirname(filePath));
  return parent && parent !== "." ? `${parent}/${stem}|${exports}` : `${stem}|${exports}`;
}
