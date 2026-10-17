import type { Comment, Node } from "@babel/types";
import { parseEnvPayload, parseMockModulePayload } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import {
  emitDirectiveDiag,
  runWithDirectiveDiags,
  type ExtractDirectivesOpts,
} from "./diag.ts";
import type { FileDirective } from "./types.ts";

// 文件级指令前缀契约（D5=F1）：`//` 与 `///` 等价（comment.value 已剥掉首个 `//`，
// `///` 形态残留一个 `/`，`//` 形态是空白/原文）。只认 CommentLine 行注释，
// 块注释与字符串里的同形文本不算。载荷文法在 core directive-scan 单源。
const ENV_REGEX = /^\/?\s*@nudo:env\s+(.+)/;
const MOCK_MODULE_REGEX = /^\/?\s*@nudo:mock-module\s+(.+)/;

/**
 * JSDoc/块注释内的文件级指令族标签检测：抽取器只认行注释，块注释形态的
 * `@nudo:env` / `@nudo:mock-module` 被静默忽略——用户照抄 `@nudo:case` 的
 * JSDoc 写法即踩坑（零警告、check 落 unknown）。不再静默：发
 * nudo:directive-syntax 警告并给出三斜线正确写法。
 * 标签只在「注释行首」匹配（可选 `*` 续行前缀，镜像 CASE_TAG_REGEX），
 * 散文行中 / `@example` 内 `///` 前缀形态不误报。
 */
const FILE_TAG_IN_BLOCK_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*)?@nudo:(env|mock-module)\b/g;

/** 块注释内错位的文件级指令族标签 → nudo:directive-syntax（复用既有码） */
function warnMisplacedFileTags(blockText: string): void {
  FILE_TAG_IN_BLOCK_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILE_TAG_IN_BLOCK_REGEX.exec(blockText))) {
    const tag = m[1]!;
    emitDirectiveDiag({
      code: DIAG.directiveSyntax,
      message:
        tag === "env"
          ? `@nudo:env is a file-level directive — use '/// @nudo:env node' at the top of the file (JSDoc block form is ignored)`
          : `@nudo:mock-module is a file-level directive — use '/// @nudo:mock-module "fs" from "./mock-fs.js"' at the top of the file (JSDoc block form is ignored)`,
    });
  }
}

/**
 * 从 AST 抽文件级指令（`@nudo:env` / `@nudo:mock-module`，只认行注释）。
 *
 * `diags`：调用方自备的诊断累积数组——JSDoc/块注释内错位的文件级指令族
 * 标签发 nudo:directive-syntax 警告（单次调用内同文案去重）。不传时为
 * 纯查询形态：诊断丢弃；若外层有 runWithDirectiveDiags 活动域，则落入
 * 该域并与其共享去重。
 */
export function extractFileDirectives(ast: Node, opts?: ExtractDirectivesOpts): FileDirective[] {
  // 不传 diags：不自成去重域——落外层 runWithDirectiveDiags 域（无则丢弃）
  if (!opts?.diags) return collectFileDirectives(ast);
  // 显式通道：runWithDirectiveDiags 换入/还原 sink（仅在本次调用内生效，
  // finally 恢复，异常不泄漏——状态本体住 diag.ts 单一模块）
  return runWithDirectiveDiags(opts.diags, () => collectFileDirectives(ast));
}

function collectFileDirectives(ast: Node): FileDirective[] {
  const results: FileDirective[] = [];
  if (ast.type !== "File") return results;

  const comments: readonly Comment[] = (ast as any).comments ?? [];
  for (const comment of comments) {
    if (comment.type === "CommentBlock") {
      warnMisplacedFileTags(comment.value);
      continue;
    }
    if (comment.type !== "CommentLine") continue;
    const text = comment.value;

    const mockModuleMatch = text.match(MOCK_MODULE_REGEX);
    if (mockModuleMatch) {
      const rec = parseMockModulePayload(mockModuleMatch[1]!);
      if (rec) {
        results.push({
          kind: "mock-module",
          source: rec.source,
          ...(rec.names ? { names: rec.names } : {}),
          fromPath: rec.fromPath,
        });
        continue;
      }
    }

    const envMatch = text.match(ENV_REGEX);
    if (envMatch) {
      const envs = parseEnvPayload(envMatch[1]!);
      if (envs.length > 0) results.push({ kind: "env", envs });
    }
  }

  return results;
}
