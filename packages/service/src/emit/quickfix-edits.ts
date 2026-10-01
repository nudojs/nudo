/**
 * action-map 物化层（#69）：CheckAction.kind + 诊断码 → 可应用的文本编辑。
 * LSP quickfix 与 `nudo check --fix` 共用；标题区分 fix / silence / review。
 *
 * 空 shape 禁令：body-read 为空时不得生成 `shape({})`（会塌签名）。
 */
import type { CheckAction } from "@nudojs/core";
import { isJsBindingIdent } from "@nudojs/core/internal";
import {
  collectParamBodyReadTypes,
  shapeDslFromFields,
  type BodyReadField,
} from "./body-read-types.ts";
import { allocNudoBinding, exportNameRepr } from "./export-binding.ts";

export type QuickfixTitleKind = "fix" | "silence" | "review" | "adjust" | "scaffold";

export type TextEdit = {
  /** 0-based */
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
};

export type QuickfixPlan = {
  titleKind: QuickfixTitleKind;
  title: string;
  /** 相对 file 的编辑 */
  edits: TextEdit[];
  /** 侧车整文件替换（新建/改写 *.nudo.js） */
  sidecar?: { path: string; newText: string };
  /** 需要额外打开/创建的文件路径 */
  openPath?: string;
};

function titlePrefix(k: QuickfixTitleKind): string {
  return `[${k}]`;
}

/** kind → 标注（Fix all 不得把 silence 当修复） */
export function titleKindFor(code: string, action: CheckAction): QuickfixTitleKind {
  switch (action.kind) {
    case "draft":
      return "fix";
    case "relax":
      return code === "nudo:unproven-return" ? "review" : "silence";
    case "mock":
    case "assume":
    case "emit":
      return "scaffold";
    case "ignore-throws":
      return "silence";
    case "callsite":
      return "fix";
    default:
      return "adjust";
  }
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在源码中找 `function <fn>` / `export function <fn>` / `const <fn> =` 的 JSDoc/声明行 */
export function findFnDeclStart(lines: string[], fnName: string): number {
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+(?<![\\w$])${escapeRegExp(fnName)}(?![\\w$])|` +
      `(?:export\\s+)?const\\s+(?<![\\w$])${escapeRegExp(fnName)}(?![\\w$])\\s*=`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) {
      // 回溯 JSDoc
      let j = i - 1;
      while (j >= 0 && (lines[j]!.trim() === "" || lines[j]!.trim().startsWith("*") || lines[j]!.trim().startsWith("/*") || lines[j]!.trim().startsWith("//"))) {
        if (lines[j]!.includes("/**") || lines[j]!.trim().startsWith("//")) return j;
        j--;
      }
      return i;
    }
  }
  return -1;
}

/** 在函数 JSDoc 里插入一行 `* @nudo:throws <Kind>`（已存在则不重复） */
export function addThrowsAnnotation(
  source: string,
  fnName: string,
  kind: string,
): { edits: TextEdit[] } | undefined {
  const lines = source.split("\n");
  const start = findFnDeclStart(lines, fnName);
  if (start < 0) return undefined;
  const kindSafe = kind.replace(/[^\w.$]/g, "") || "Error";
  const tag = ` * @nudo:throws ${kindSafe}`;
  for (let i = Math.max(0, start - 15); i < Math.min(lines.length, start + 3); i++) {
    if (lines[i]!.includes(`@nudo:throws ${kindSafe}`)) return { edits: [] };
  }
  // 已有 JSDoc：单行 `/** … */` 先展开；多行在 `*/` 行之前插入 tag
  for (let i = start; i < Math.min(lines.length, start + 30); i++) {
    const t = lines[i]!;
    const closeIdx = t.indexOf("*/");
    const openIdx = t.indexOf("/**");
    if (openIdx !== -1 && closeIdx > openIdx) {
      // 单行 JSDoc：展开成块，避免 tag 被插到 `/**` 之前
      const inner = t.slice(openIdx + 3, closeIdx).trim();
      const innerLine = inner ? ` * ${inner}\n` : "";
      return {
        edits: [
          {
            startLine: i,
            startCol: 0,
            endLine: i,
            endCol: t.length,
            newText: `/**\n${innerLine}${tag}\n */`,
          },
        ],
      };
    }
    if (closeIdx !== -1) {
      return {
        edits: [
          {
            startLine: i,
            startCol: 0,
            endLine: i,
            endCol: 0,
            newText: `${tag}\n`,
          },
        ],
      };
    }
    if (t.trim().startsWith("/**")) continue;
    if (i > start && !t.trim().startsWith("*") && !t.trim().startsWith("/*")) break;
  }
  // 无 JSDoc：在声明前插入完整块
  return {
    edits: [
      {
        startLine: start,
        startCol: 0,
        endLine: start,
        endCol: 0,
        newText: `/**\n${tag}\n */\n`,
      },
    ],
  };
}

/**
 * 侧车里导出名 → 模块绑定名（DESIGN-003 别名段：`export { _nudo_1 as class }`）。
 * 查找键恒为**导出名**（身份）；直接同名 / 非别名形态 → undefined。
 */
export function sidecarBindingFor(sidecarSource: string, exportName: string): string | undefined {
  for (const m of sidecarSource.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const t = part.trim();
      if (!t) continue;
      const asMatch = /^([\w$]+)\s+as\s+(.+)$/.exec(t);
      if (!asMatch) continue;
      const local = asMatch[1]!;
      let exported = asMatch[2]!.trim();
      if (exported.startsWith('"') || exported.startsWith("'")) {
        try {
          exported = JSON.parse(exported.replace(/^'|'$/g, '"')) as string;
        } catch {
          continue;
        }
      }
      if (exported === exportName) return local;
    }
  }
  return undefined;
}

/**
 * 定位侧车里目标契约的声明起点：`export const <name> = fn(` / `<name> = fn(`。
 * DESIGN-003：查找键恒为**导出名**（身份）——别名段先经 sidecarBindingFor
 * 解析绑定（`const _nudo_1 = fn(…); export { _nudo_1 as class }`）。
 * 返回声明 start 与 fn 调用开括号位置；找不到 → undefined。
 */
export function matchSidecarFnDecl(
  sidecarSource: string,
  exportName: string,
): { start: number; openParen: number } | undefined {
  const fn = escapeRegExp(exportName);
  const startRe = new RegExp(
    `(?:export\\s+const\\s+${fn}\\s*=\\s*|(?<![\\w$])${fn}\\s*=\\s*)fn\\s*\\(`,
  );
  let m = sidecarSource.match(startRe);
  if (!m || m.index === undefined) {
    const binding = sidecarBindingFor(sidecarSource, exportName);
    if (binding === undefined) return undefined;
    m = sidecarSource.match(
      new RegExp(`(?<![\\w$])${escapeRegExp(binding)}\\s*=\\s*fn\\s*\\(`),
    );
  }
  if (!m || m.index === undefined) return undefined;
  return { start: m.index, openParen: m.index + m[0].lastIndexOf("(") };
}

/**
 * 侧车 return 契约包一层 `nullable(...)`（nullish 臂违例的机械修法）。
 * 只改目标 fn 的 return 位。
 */
export function wrapReturnNullable(
  sidecarSource: string,
  fnName: string,
): string | undefined {
  const located = matchSidecarFnDecl(sidecarSource, fnName);
  if (located === undefined) return undefined;
  const start = located.start;
  const open = located.openParen;
  let depth = 0;
  let end = -1;
  for (let i = open; i < sidecarSource.length; i++) {
    const ch = sidecarSource[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return undefined;
  const region = sidecarSource.slice(start, end + 1);
  // `fn({...}, <return>)` 第二个顶层实参
  let argDepth = 0;
  let comma = -1;
  for (let i = open + 1; i < end; i++) {
    const ch = sidecarSource[i]!;
    if (ch === "(" || ch === "{" || ch === "[") argDepth++;
    else if (ch === ")" || ch === "}" || ch === "]") argDepth--;
    else if (ch === "," && argDepth === 0) {
      comma = i;
      break;
    }
  }
  if (comma < 0) return undefined;
  let retStart = comma + 1;
  while (retStart < end && /\s/.test(sidecarSource[retStart]!)) retStart++;
  const retExpr = sidecarSource.slice(retStart, end).trim();
  if (!retExpr || retExpr.startsWith("nullable(") || retExpr.startsWith("union(")) {
    return undefined;
  }
  const next =
    sidecarSource.slice(0, retStart) +
    `nullable(${retExpr})` +
    sidecarSource.slice(end);
  return next;
}

/** `@nudo:budget forks=N` 注解 */
export function addBudgetAnnotation(
  source: string,
  fnName: string,
  forks = 64,
): { edits: TextEdit[] } | undefined {
  const lines = source.split("\n");
  const start = findFnDeclStart(lines, fnName);
  if (start < 0) return undefined;
  if (source.includes(`@nudo:budget`)) return { edits: [] };
  return {
    edits: [
      {
        startLine: start,
        startCol: 0,
        endLine: start,
        endCol: 0,
        newText: `/**\n * @nudo:budget forks=${forks}\n */\n`,
      },
    ],
  };
}

/** 把 edits 应用到源码（按 start 从后往前） */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const lines = source.split("\n");
  const sorted = [...edits].sort(
    (a, b) => b.startLine - a.startLine || b.startCol - a.startCol,
  );
  for (const e of sorted) {
    const before = lines.slice(0, e.startLine);
    const after = lines.slice(e.endLine + 1);
    const startLineText = lines[e.startLine] ?? "";
    const endLineText = lines[e.endLine] ?? startLineText;
    const merged =
      startLineText.slice(0, e.startCol) + e.newText + endLineText.slice(e.endCol);
    lines.splice(e.startLine, e.endLine - e.startLine + 1, merged);
  }
  return lines.join("\n");
}

export type MaterializeInput = {
  code: string;
  fn?: string;
  file: string;
  source: string;
  sidecarText?: string;
  sidecarPath: string;
  action: CheckAction;
  /** 诊断里的 throws 类型（entry-may-throw） */
  throwsKind?: string;
  expected?: string;
  suggestion?: string;
};

/**
 * kind → WorkspaceEdit 物化。返回 undefined = 该 action 只读（info）或缺证据。
 */
export function materializeAction(input: MaterializeInput): QuickfixPlan | undefined {
  const { code, action, fn, source, sidecarText, sidecarPath } = input;
  const tk = titleKindFor(code, action);

  // —— entry-may-throw：@nudo:throws（silence）——
  if (code === "nudo:entry-may-throw" && action.kind === "relax" && fn) {
    const kind =
      input.throwsKind ??
      input.suggestion?.match(/@nudo:throws\s+(\w+)/)?.[1] ??
      "Error";
    const r = addThrowsAnnotation(source, fn, kind);
    if (!r) return undefined;
    return {
      titleKind: "silence",
      title: `${titlePrefix("silence")} Declare @nudo:throws ${kind} on ${fn}`,
      edits: r.edits,
    };
  }

  // —— entry-may-throw：侧车 param contract（fix）——
  // 空 shape 禁令：无 body-read 证据时只给 draft 命令，不生成 shape({})
  // 类型：body 用法推断（node.type === … → string()），无证据 any()
  if (code === "nudo:entry-may-throw" && action.kind === "draft" && fn) {
    const bodyRead = input.suggestion?.match(/body-read\s*\{([^}]+)\}/)?.[1];
    const fieldNames = bodyRead
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // 用法推断优先；诊断只有字段名时用推断补类型
    const inferred = collectParamBodyReadTypes(source).get(fn);
    // 找到含这些字段的形参（常见单参 helpers）
    let fields: BodyReadField[] | undefined;
    let paramName = "arg";
    if (inferred) {
      for (const [pname, list] of inferred) {
        if (fieldNames && fieldNames.length > 0) {
          const hit = list.filter((f) => fieldNames.includes(f.field));
          if (hit.length > 0) {
            fields = hit;
            paramName = pname;
            break;
          }
        } else if (list.length > 0) {
          fields = list;
          paramName = pname;
          break;
        }
      }
    }
    if (!fields || fields.length === 0) {
      if (!fieldNames || fieldNames.length === 0) {
        return {
          titleKind: "fix",
          title: `${titlePrefix("fix")} Add sidecar param contract for ${fn} (via nudo contract --draft)`,
          edits: [],
          openPath: sidecarPath,
        };
      }
      // 有字段名但无用法证据：any() 占位（不用武断 string()）
      fields = fieldNames.map((f) => ({ field: f, type: "any()", via: "read (no type evidence)" }));
    }
    const shapeText = shapeDslFromFields(fields);
    // DESIGN-003：身份=导出名 fn。绑定名不安全（保留字 / 非 ident）时别名
    // 发射（_nudo_<n> 按既有侧车内容避让），导出面保身份
    const direct = isJsBindingIdent(fn);
    const clause = direct
      ? `export const ${fn} = fn({ ${paramName}: ${shapeText} });\n`
      : (() => {
          const used = new Set(
            [...(sidecarText ?? "").matchAll(/(?<![\w$])_nudo_(\d+)(?![\w$])/g)].map(
              (x) => x[0]!,
            ),
          );
          const binding = allocNudoBinding((n) => used.has(n));
          return `const ${binding} = fn({ ${paramName}: ${shapeText} });\nexport { ${binding} as ${exportNameRepr(fn)} };\n`;
        })();
    const next =
      sidecarText && sidecarText.trim().length > 0
        ? sidecarText.endsWith("\n")
          ? sidecarText + clause
          : sidecarText + "\n" + clause
        : `// Generated by quickfix — review before accepting\n${clause}`;
    return {
      titleKind: "fix",
      title: `${titlePrefix("fix")} Add sidecar param contract for ${fn} (${fields.map((f) => `${f.field}: ${f.type}`).join(", ")})`,
      edits: [],
      sidecar: { path: sidecarPath, newText: next },
      openPath: sidecarPath,
    };
  }

  // —— constraint-violated nullish → nullable(…) ——
  if (
    code === "nudo:constraint-violated" &&
    (action.kind === "relax" || action.kind === "draft") &&
    fn &&
    sidecarText &&
    (/nullish/i.test(input.suggestion ?? "") || /nullish/i.test(input.expected ?? "") ||
      /use nullable/i.test(input.suggestion ?? ""))
  ) {
    const next = wrapReturnNullable(sidecarText, fn);
    if (next && next !== sidecarText) {
      return {
        titleKind: "fix",
        title: `${titlePrefix("fix")} Wrap ${fn} return contract in nullable(…)`,
        edits: [],
        sidecar: { path: sidecarPath, newText: next },
      };
    }
  }

  // —— unproven-return：relax（review，须看 diff）——
  if (code === "nudo:unproven-return" && action.kind === "relax" && fn && sidecarText) {
    // 调用方（LSP）已有 relaxSidecarConstraint；这里给标题，edit 由调用方补
    return {
      titleKind: "review",
      title: `${titlePrefix("review")} Relax return contract for ${fn} to inferred surface`,
      edits: [],
      openPath: sidecarPath,
    };
  }

  // —— recursion-truncated：@nudo:budget ——
  if (code === "nudo:recursion-truncated" && fn) {
    const r = addBudgetAnnotation(source, fn);
    if (!r) return undefined;
    return {
      titleKind: "adjust",
      title: `${titlePrefix("adjust")} Add @nudo:budget forks=64 on ${fn}`,
      edits: r.edits,
    };
  }

  // —— unknown-inference / opaque-result：scaffold draft ——
  if (
    (code === "nudo:unknown-inference" || code === "nudo:opaque-result") &&
    (action.kind === "mock" || action.kind === "draft")
  ) {
    return {
      titleKind: "scaffold",
      title: `${titlePrefix("scaffold")} ${action.label}`,
      edits: [],
      openPath: code === "nudo:opaque-result" ? input.file : sidecarPath,
    };
  }

  return undefined;
}
