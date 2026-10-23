import type { Comment, File, Node } from "@babel/types";
import {
  listFnDirectiveScopes,
  parseEnvPayload,
  parseMockModulePayload,
} from "@nudojs/core";
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
// Bug 417：**裸标签**（`/// @nudo:env` 没写 env 名）此前整行不匹配 ⇒ 零诊断
// 地丢弃 ⇒ env 未解析 ⇒ 全局 `unknown`。⇒ 单独识别并给诊断。
const ENV_BARE_REGEX = /^\/?\s*@nudo:env\b[ \t]*$/;
const MOCK_MODULE_REGEX = /^\/?\s*@nudo:mock-module\s+(.+)/;

/**
 * JSDoc/块注释内的文件级指令族标签检测：抽取器只认行注释，块注释形态的
 * `@nudo:env` / `@nudo:mock-module` 被静默忽略——用户照抄 `@nudo:case` 的
 * JSDoc 写法即踩坑（零警告、check 落 unknown）。不再静默：发
 * nudo:directive-syntax 警告并给出三斜线正确写法。
 * 标签只在「注释行首」匹配（可选 `*` 续行前缀，镜像 CASE_TAG_REGEX），
 * 散文行中 / `@example` 内 `///` 前缀形态不误报。
 *
 * Bug 416：`@nudo:import` 同属文件级指令族 —— 此前 core 的**文本扫描通道**
 * 把行注释与块注释拍平（丢掉 kind）⇒ 块注释里的 import **真的生效**，
 * 与本 AST 通道「块注释忽略并告警」的口径**相反**。⇒ 纳入同一告警族。
 */
const FILE_TAG_IN_BLOCK_REGEX =
  /(?:^|\n)[ \t]*(?:\*[ \t]*)?@nudo:(env|mock-module|import)\b/g;

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
          : tag === "mock-module"
            ? `@nudo:mock-module is a file-level directive — use '/// @nudo:mock-module "fs" from "./mock-fs.js"' at the top of the file (JSDoc block form is ignored)`
            : `@nudo:import is a file-level directive — use '/// @nudo:import { a } from "./x.nudo.js"' at the top of the file (JSDoc block form is ignored)`,
    });
  }
}

/**
 * 行注释形态的文件级指令**位置错位**（落在函数体内）→ nudo:directive-syntax。
 * 与块注释形态对称：块形态被忽略且告警，行形态此前被**静默提升**成整文件作用域
 * （Bug 847）——现在同样忽略 + 告警。
 */
function warnMisplacedFileTagLine(tag: "env" | "mock-module"): void {
  emitDirectiveDiag({
    code: DIAG.directiveSyntax,
    message:
      tag === "env"
        ? `@nudo:env is a file-level directive — use '/// @nudo:env node' at the top of the file (line comment inside a function body is ignored)`
        : `@nudo:mock-module is a file-level directive — use '/// @nudo:mock-module "fs" from "./mock-fs.js"' at the top of the file (line comment inside a function body is ignored)`,
  });
}

/**
 * 函数体区间（顶层判定用）：文件级指令**不得**落在任何函数体内——函数体里的
 * `/// @nudo:env node` 不是「本函数用 node env」，此前被**静默提升**成整文件 env
 * （Bug 847）。顶层位置（文件头 / `export` 行 / 语句之间）一律放行。
 *
 * 与 core 文本路径（`directive-scan.ts` 的 `functionBodyRanges`）同口径。
 */
function functionBodyRanges(ast: Node): [number, number][] {
  if (ast.type !== "File") return [];
  return listFnDirectiveScopes(ast as File).map((scope) => [
    scope.node.start ?? 0,
    scope.node.end ?? 0,
  ]);
}

/** 偏移是否落在某个函数体内 */
function inFunctionBody(ranges: [number, number][], offset: number): boolean {
  return ranges.some(([s, e]) => offset >= s && offset < e);
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
  // Bug 847：文件级指令的**位置**闸门——行注释形态不得落在**函数体内**。
  // 此前只看文本不看位置 ⇒ 函数体里的 `/// @nudo:env node` 被**静默提升**成
  // 整文件 env（零诊断）；现在不提升 + 告警。
  const fnRanges = functionBodyRanges(ast);
  for (const comment of comments) {
    if (comment.type === "CommentBlock") {
      warnMisplacedFileTags(comment.value);
      continue;
    }
    if (comment.type !== "CommentLine") continue;
    const text = comment.value;

    const misplaced =
      typeof comment.start === "number" && inFunctionBody(fnRanges, comment.start);
    if (misplaced) {
      if (MOCK_MODULE_REGEX.test(text)) warnMisplacedFileTagLine("mock-module");
      else if (ENV_REGEX.test(text) || ENV_BARE_REGEX.test(text)) warnMisplacedFileTagLine("env");
      continue;
    }

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
      // Bug 415：标签命中但**载荷解析失败** ⇒ 不得静默丢弃（此前无 else
      // 分支 ⇒ 指令静默蒸发：mock 不生效、门禁照常绿）。
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `Unrecognized @nudo:mock-module form (expected '"src" from "path"' or '"src" { a, b } from "path"')`,
      });
      continue;
    }

    const envMatch = text.match(ENV_REGEX);
    if (envMatch) {
      const envs = parseEnvPayload(envMatch[1]!);
      if (envs.length > 0) {
        results.push({ kind: "env", envs });
      } else {
        // Bug 417：载荷里**一个 env 名都读不出来** ⇒ 指令不生效 ⇒ 用户看得见
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `Unrecognized @nudo:env list (expected env names, e.g. '/// @nudo:env node, web')`,
        });
      }
      continue;
    }
    // Bug 417：**裸标签**（没写 env 名）⇒ 指令不生效且此前零诊断
    if (ENV_BARE_REGEX.test(text)) {
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `@nudo:env requires at least one env name (e.g. '/// @nudo:env node')`,
      });
    }
  }

  return results;
}
