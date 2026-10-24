/**
 * 路径错误通道（`pathErrors[]`）——CLI / LSP agent 工具面共用同一份抽象。
 *
 * 背景（Bug 956）：CLI 的 `nudo check --json` / `nudo test --json` 对「路径
 * 不可用」给**结构化信封**（`pathErrors[]` + `nudo:path-not-found` 等码 +
 * suggestion），而 LSP agent 工具面（`packages/lsp/src/agent-tools.ts`）直接
 * `readSource` ⇒ 文件不存在就抛 ENOENT、被原样转成裸文本 ⇒ 即使请求里写了
 * `format:"json"`，返回的也不是 JSON。
 *
 * 本模块把 CLI 侧唯一的路径错误抽象（`packages/nudojs/src/commands/shared.ts`
 * 的 `PathError` / `resolveTargetsCollect`）下沉到 service：文案与码**逐字
 * 同源**，两端不再各写一份。
 */
import { existsSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { DIAG } from "@nudojs/core/internal";
import { isNudoTargetPath } from "./target-path.ts";

/** 路径错误码（与 CLI 的 `PathError` 码集一致）。 */
export type PathErrorCode =
  | typeof DIAG.pathNotFound
  | typeof DIAG.pathEmptyDir
  | typeof DIAG.pathNotTarget
  | typeof DIAG.pathMissingCallsite
  /** IO 失败（mkdir/write）——原始 errno 不进产品面 */
  | typeof DIAG.pathIo;

/** 路径错误（--json 信封的 pathErrors 面；非 JSON 面走 usage error）。 */
export type PathError = {
  path: string;
  code: PathErrorCode;
  message: string;
  suggestion: string;
};

/** 路径不存在（CLI 同口径文案）。 */
export function pathNotFoundError(path: string): PathError {
  return {
    path,
    code: DIAG.pathNotFound,
    message: `Not found: ${path}`,
    suggestion: `check the path; it must be an existing .js/.mjs/.ts file or a directory containing them`,
  };
}

/**
 * 路径错误的**非 JSON 面**文案（CLI 的 usage error 面同口径）：
 * 一行原因 + 一行 `fix:` 提示。
 */
export function formatPathErrorText(errors: PathError[]): string {
  return errors.map((e) => `Error: ${e.message}\nfix:  ${e.suggestion}`).join("\n");
}

/**
 * 「分析目标」闸门（与 CLI `resolveTargetsCollect` 的文件分支同口径）：
 * 侧车契约模块（`*.nudo.js` / `*.nudo.draft.*`）、类型声明（`.d.ts`）、
 * JSX（`.jsx` / `.tsx`）**不是分析目标**——把它们送进分析器会得到
 * 「0 个函数 ⇒ 0 error ⇒ 判绿」的**假绿**（或把契约 DSL 构造器当成真实
 * 调用点报成 case）。
 *
 * 目录同样不是分析目标（CLI 侧目录会被展开成文件列表，agent 工具面的
 * `file` 参数是**单文件**）。
 *
 * 路径不存在时**不**在此判定（读取通道负责报 path-not-found）——宿主可能
 * 持有尚未落盘的 buffer。
 */
export function targetPathError(path: string): PathError | undefined {
  const resolved = resolvePath(path);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return {
      path: resolved,
      code: DIAG.pathNotTarget,
      message: `Not an analysis target (need a .js/.mjs/.ts file, not a directory): ${resolved}`,
      suggestion: `pass a single .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)`,
    };
  }
  if (!isNudoTargetPath(resolved)) {
    return {
      path: resolved,
      code: DIAG.pathNotTarget,
      message: `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${resolved}`,
      suggestion: `pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)`,
    };
  }
  return undefined;
}
