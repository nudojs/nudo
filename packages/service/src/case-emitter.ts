import { type TypeValue } from "@nudojs/core";
import { parse, extractDirectives } from "@nudojs/parser";
import type { CaseDirective } from "@nudojs/parser";
import type { AnalysisResult } from "./analyzer.ts";

/**
 * 调用点固化（case emission）：把分析产出的合成 case（call@L* / call@symbolic）
 * 序列化为 `@nudo:case` 指令注释文本、从源码剥离已生成指令、把指令插回源码。
 *
 * 指令文法权威是 parser 的 parseTypeValueExpr；它对字符串字面量做的是
 * 原样 slice（不反转义），因此这里的"转义"策略是：选择一种引号包裹使值
 * 原样保留（含 `"` 的值用单引号包裹，反之亦然），无法原样保留的值一律
 * 返回 null（见 serializeStringLiteral）。
 */

/** 合成 case 的名字前缀；带此前缀的 @nudo:case 视为本模块生成物 */
const GENERATED_PREFIX = "call@";

/** 行首形如 ` * @nudo:case "call@…" (` 的指令行（整行都是指令内容） */
const GENERATED_CASE_LINE_REGEX = /^\s*\*?\s*@nudo:case\s+"(call@[^"]*)"/;

/** 合法裸写的对象键：JS 标识符 */
const IDENT_KEY_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** parseTypeValueExpr 能吃回去的数字字面量（科学计数法等不收） */
const NUMBER_LITERAL_REGEX = /^-?\d+(\.\d+)?$/;

/** 字符串值中会破坏指令行结构的字符：参数逗号切分 / 括号配对（冒号在值位置安全，键位置才禁） */
const UNSAFE_STRING_CHARS = /[,()[\]{}]/;

/** 对象键的额外禁用字符：键内冒号会让解析侧的 findTopLevelColon 错位 */
const UNSAFE_KEY_CHARS = /[,()[\]{}:]/;

/** 控制字符（含换行）：指令必须单行 */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * 字符串字面量 → 可被 parseTypeValueExpr 原样解析回去的带引号文本。
 * 两种引号并存、含逗号/括号/冒号等结构字符、控制字符、块注释终止序列
 * （会提前结束 JSDoc 块）时无法安全表达，返回 null。
 */
function serializeStringLiteral(value: string): string | null {
  if (CONTROL_CHARS.test(value)) return null;
  if (value.includes("*/")) return null;
  if (UNSAFE_STRING_CHARS.test(value)) return null;
  const hasDbl = value.includes('"');
  const hasSgl = value.includes("'");
  if (hasDbl && hasSgl) return null;
  return hasDbl ? `'${value}'` : `"${value}"`;
}

/** 对象键 → 裸标识符或双引号包裹；无法安全表达返回 null */
function serializeObjectKey(key: string): string | null {
  if (IDENT_KEY_REGEX.test(key)) return key;
  if (CONTROL_CHARS.test(key)) return null;
  if (key.includes('"')) return null; // 双引号包裹承载不了自带双引号的键
  if (UNSAFE_KEY_CHARS.test(key) || key.includes("*/")) return null;
  // 解析侧 strip 正则会吃掉首尾引号字符，键自身以引号开头/结尾时会错位
  if (/^['"]|['"]$/.test(key)) return null;
  return `"${key}"`;
}

/** 单个 TypeValue → parseTypeValueExpr 可解析回去的表达式文本；不可表达返回 null */
export function serializeCaseArg(tv: TypeValue): string | null {
  switch (tv.kind) {
    case "primitive":
      // bigint / symbol 不在指令文法内
      if (tv.type === "number" || tv.type === "string" || tv.type === "boolean") {
        return `T.${tv.type}`;
      }
      return null;
    case "unknown":
      return "T.unknown";
    case "never":
      return "T.never";
    case "literal": {
      const v = tv.value;
      if (typeof v === "number") {
        // NaN / Infinity / 1e21 等序列化后文法解析不回同值
        if (!Number.isFinite(v)) return null;
        const s = String(v);
        return NUMBER_LITERAL_REGEX.test(s) ? s : null;
      }
      if (typeof v === "boolean") return v ? "true" : "false";
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      return serializeStringLiteral(v);
    }
    case "union": {
      const parts: string[] = [];
      for (const member of tv.members) {
        const s = serializeCaseArg(member);
        if (s === null) return null;
        parts.push(s);
      }
      return `T.union(${parts.join(", ")})`;
    }
    case "array": {
      const el = serializeCaseArg(tv.element);
      return el === null ? null : `T.array(${el})`;
    }
    case "tuple": {
      const parts: string[] = [];
      for (const el of tv.elements) {
        const s = serializeCaseArg(el);
        if (s === null) return null;
        parts.push(s);
      }
      return `[${parts.join(", ")}]`;
    }
    case "object": {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(tv.properties)) {
        const vs = serializeCaseArg(value);
        if (vs === null) return null;
        const ks = serializeObjectKey(key);
        if (ks === null) return null;
        parts.push(`${ks}: ${vs}`);
      }
      return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
    }
    default:
      // function / promise / instance / refined：指令文法不可表达
      return null;
  }
}

/**
 * 组装单行 ` * @nudo:case "name" (a, b)` 指令文本（无尾换行）。
 * 任一实参不可序列化、或名字含双引号/换行（名字正则 `"([^"]+)"` 承载不了）→ 整体 null。
 */
export function buildCaseDirective(name: string, args: TypeValue[]): string | null {
  if (name.includes('"') || /[\r\n]/.test(name)) return null;
  const parts: string[] = [];
  for (const arg of args) {
    const s = serializeCaseArg(arg);
    if (s === null) return null;
    parts.push(s);
  }
  return ` * @nudo:case "${name}" (${parts.join(", ")})`;
}

/**
 * 从源码剥离所有本模块生成的 @nudo:case 指令（名字以 call@ 开头，整行删除）。
 * 若所属 JSDoc 块因此只剩空 ` *` 行（无其他 @nudo:* 指令、无文字内容），
 * 连块首 `/**` 行与块尾行整块删除。绝不碰非 case 指令与普通注释。
 * 注意：手写但以 call@ 命名的 case 同样会被删——call@ 前缀保留为生成物标记。
 * removed 返回被删指令名列表（按出现顺序）。
 */
export function stripGeneratedCaseDirectives(source: string): { source: string; removed: string[] } {
  const lines = source.split("\n");
  const removed: string[] = [];
  const drop = new Array<boolean>(lines.length).fill(false);

  // 第一遍：标记 call@ 指令行
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(GENERATED_CASE_LINE_REGEX);
    if (m) {
      drop[i] = true;
      removed.push(m[1]);
    }
  }

  // 第二遍：删除后只剩空星号行的 JSDoc 块整体移除
  for (let i = 0; i < lines.length; i++) {
    // 开行必须是纯 `/**`（带文字的块不是本模块生成形状）
    if (!/^\s*\/\*\*\s*$/.test(lines[i])) continue;
    let j = i + 1;
    let clean = true;
    while (j < lines.length) {
      if (/\*\//.test(lines[j])) break;
      if (/\/\*/.test(lines[j])) {
        clean = false; // 块内异常嵌套，保守放弃
        break;
      }
      j++;
    }
    if (!clean || j >= lines.length) continue;
    // 结束行必须是纯 `*/`（如 `* text */` 的块结构不干净，不动）
    if (!/^\s*\*\/\s*$/.test(lines[j])) continue;
    let onlyFiller = true;
    for (let k = i + 1; k < j; k++) {
      if (drop[k]) continue;
      const t = lines[k].trim();
      if (t !== "" && !/^\*{1,2}$/.test(t)) {
        onlyFiller = false;
        break;
      }
    }
    if (onlyFiller) {
      for (let k = i; k <= j; k++) drop[k] = true;
    }
  }

  return {
    source: lines.filter((_, i) => !drop[i]).join("\n"),
    removed,
  };
}

export type EmitSkipReason =
  | "hand-written"
  | "already-generated"
  | "entry-only"
  | "no-serializable-cases"
  | "no-declaration"
  | "skipped";

export type EmitResult = {
  source: string;
  changed: boolean;
  written: Array<{ fn: string; cases: string[] }>;
  skipped: Array<{ fn: string; reason: EmitSkipReason; detail?: string }>;
};

/** 源码里某函数名下已有的 case 指令（跨同名顶层语句合并收集） */
function collectExistingCases(source: string): Map<string, CaseDirective[]> {
  const byName = new Map<string, CaseDirective[]>();
  let ast;
  try {
    ast = parse(source, { errorRecovery: true });
  } catch {
    return byName; // 源码解析失败时按"无已有指令"处理（analysis 本就来自同一份源码）
  }
  for (const { name, directives } of extractDirectives(ast)) {
    for (const d of directives) {
      if (d.kind !== "case") continue;
      const list = byName.get(name);
      if (list) list.push(d);
      else byName.set(name, [d]);
    }
  }
  return byName;
}

/**
 * 把 analysis 中的合成 case（source === "callsite"）固化为源码指令：
 *
 * 1. 源码已有任何非 call@ 命名的 case → skip "hand-written"；
 *    已有 call@ case → skip "already-generated"。
 * 2. fn.skipped / fn.noDeclaration / fn.entryOnly → 对应 skip。
 * 3. 逐 case 序列化；个别不可序列化的丢弃并在 skipped 记
 *    no-serializable-cases（函数整体仍写可序列化子集，全不可序列化才整函数跳过）。
 * 4. 写入位置：函数声明行正上方——已有 JSDoc 块则插到 `/**` 行后，
 *    无块则新建三行块。缩进取声明行的 loc.start.column（babel 0 基列）。
 *    多函数编辑按行号从下往上应用，避免行号漂移。
 */
export function insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult {
  const written: EmitResult["written"] = [];
  const skipped: EmitResult["skipped"] = [];
  const existing = collectExistingCases(source);

  type Edit = { line: number; column: number; directives: string[]; fn: string };
  const edits: Edit[] = [];

  for (const fn of analysis.functions) {
    const existingCases = existing.get(fn.name) ?? [];
    if (existingCases.some((c) => !c.name.startsWith(GENERATED_PREFIX))) {
      skipped.push({ fn: fn.name, reason: "hand-written" });
      continue;
    }
    if (existingCases.length > 0) {
      skipped.push({ fn: fn.name, reason: "already-generated" });
      continue;
    }
    if (fn.skipped) {
      skipped.push({ fn: fn.name, reason: "skipped" });
      continue;
    }
    if (fn.noDeclaration) {
      skipped.push({ fn: fn.name, reason: "no-declaration" });
      continue;
    }
    if (fn.entryOnly) {
      skipped.push({ fn: fn.name, reason: "entry-only" });
      continue;
    }
    const callsiteCases = fn.cases.filter((c) => c.source === "callsite");
    if (callsiteCases.length === 0) {
      skipped.push({ fn: fn.name, reason: "no-serializable-cases", detail: "no callsite cases" });
      continue;
    }
    const built: string[] = [];
    const names: string[] = [];
    for (const c of callsiteCases) {
      const directive = buildCaseDirective(c.name, c.args);
      if (directive === null) {
        skipped.push({ fn: fn.name, reason: "no-serializable-cases", detail: `case ${c.name} not serializable` });
      } else {
        built.push(directive);
        names.push(c.name);
      }
    }
    if (built.length === 0) continue; // 全部不可序列化：上方已逐 case 记录 skip
    edits.push({ line: fn.loc.start.line, column: fn.loc.start.column, directives: built, fn: fn.name });
    written.push({ fn: fn.name, cases: names });
  }

  // 从下往上应用编辑
  edits.sort((a, b) => b.line - a.line);
  const lines = source.split("\n");
  for (const edit of edits) {
    const declIdx = edit.line - 1;
    const indent = " ".repeat(edit.column);

    // 声明行正上方是否挂着可注入的 JSDoc 块（结束行必须是纯 `*/`）
    let insertIdx = -1;
    let blockIndent = "";
    const aboveIdx = declIdx - 1;
    if (aboveIdx >= 0 && /^\s*\*\/\s*$/.test(lines[aboveIdx])) {
      let s = aboveIdx - 1;
      while (s >= 0) {
        const t = lines[s];
        if (/^\s*\/\*\*/.test(t)) {
          insertIdx = s + 1; // 指令行插到 `/**` 行后第一行
          blockIndent = t.match(/^\s*/)?.[0] ?? "";
          break;
        }
        // 块内部行：星号续行 / 空行 / 块尾；撞到其他内容说明上面不是干净的注释块
        if (/^\s*\*/.test(t) || t.trim() === "") {
          s--;
          continue;
        }
        break;
      }
    }

    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, ...edit.directives.map((d) => blockIndent + d));
    } else {
      lines.splice(declIdx, 0, `${indent}/**`, ...edit.directives.map((d) => indent + d), `${indent} */`);
    }
  }

  return {
    source: lines.join("\n"),
    changed: written.length > 0,
    written,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// unified diff（行级 LCS，无第三方依赖）
// ---------------------------------------------------------------------------

type DiffOp = { type: "equal" | "delete" | "insert"; text: string };

/** 行级 LCS：先裁公共前后缀把 DP 表压到真实差异窗口，再回溯产出操作序列 */
function diffOps(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  // dp[i*(m+1)+j] = midA[i:] 与 midB[j:] 的 LCS 长度
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        midA[i] === midB[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ type: "equal", text: a[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ type: "equal", text: midA[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      ops.push({ type: "delete", text: midA[i] });
      i++;
    } else {
      ops.push({ type: "insert", text: midB[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "delete", text: midA[i++] });
  while (j < m) ops.push({ type: "insert", text: midB[j++] });
  for (let k = endA; k < a.length; k++) ops.push({ type: "equal", text: a[k] });
  return ops;
}

const DIFF_CONTEXT = 3;

/** `@@ -1,3 +1,4 @@` 风格的范围描述；count 为 1 时省略 `,c`，为 0 时行号回退一行 */
function formatRange(start: number, count: number): string {
  const s = count === 0 ? start - 1 : start;
  return count === 1 ? `${s}` : `${s},${count}`;
}

/** 行级 unified diff：`--- a/path` 头 + `@@` hunk + 上下文 3 行；相同返回 "" */
export function unifiedDiff(a: string, b: string, path: string): string {
  if (a === b) return "";
  const ops = diffOps(a.split("\n"), b.split("\n"));

  // 切 hunk：变更之间相等行 ≤ 2*context 时合并为一个 hunk
  const hunks: Array<{ start: number; ops: DiffOp[] }> = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type === "equal") {
      idx++;
      continue;
    }
    let start = idx;
    let ctx = 0;
    while (start > 0 && ops[start - 1].type === "equal" && ctx < DIFF_CONTEXT) {
      start--;
      ctx++;
    }
    let j = idx;
    let equalRun = 0;
    let lastChange = idx;
    while (j < ops.length) {
      if (ops[j].type === "equal") {
        equalRun++;
        if (equalRun > DIFF_CONTEXT * 2) break;
      } else {
        equalRun = 0;
        lastChange = j;
      }
      j++;
    }
    let end = lastChange + 1;
    ctx = 0;
    while (end < ops.length && ops[end].type === "equal" && ctx < DIFF_CONTEXT) {
      end++;
      ctx++;
    }
    hunks.push({ start, ops: ops.slice(start, end) });
    idx = end;
  }

  // hunk 头行号：hunk 前累计的 delete+equal 决定旧侧、insert+equal 决定新侧
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (let h = 0; h < hunks.length; h++) {
    const { start, ops: hunkOps } = hunks[h];
    let oldCount = 0;
    let newCount = 0;
    for (let k = 0; k < start; k++) {
      if (ops[k].type !== "insert") oldCount++;
      if (ops[k].type !== "delete") newCount++;
    }
    let dels = 0;
    let ins = 0;
    for (const op of hunkOps) {
      if (op.type === "delete") dels++;
      else if (op.type === "insert") ins++;
      else {
        dels++;
        ins++;
      }
    }
    out.push(`@@ -${formatRange(oldCount + 1, dels)} +${formatRange(newCount + 1, ins)} @@`);
    for (const op of hunkOps) {
      const prefix = op.type === "equal" ? " " : op.type === "delete" ? "-" : "+";
      out.push(prefix + op.text);
    }
  }
  return out.join("\n") + "\n";
}
