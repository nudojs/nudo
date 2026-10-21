import { type Abs } from "@nudojs/core";
import { ProjectionBudget } from "@nudojs/core/internal";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import type { CaseDirective } from "@nudojs/parser";
import type { AnalysisResult } from "../analyzer.ts";

/**
 * 调用点固化（case emission）：把分析产出的合成 case（call@L* / call@symbolic）
 * 序列化为 `@nudo:case` 指令注释文本、从源码剥离已生成指令、把指令插回源码。
 *
 * 指令文法权威是 parser 的 parseCaseArgExpr；它对字符串字面量做的是
 * 原样 slice（不反转义），因此这里的"转义"策略是：选择一种引号包裹使值
 * 原样保留（含 `"` 的值用单引号包裹，反之亦然），无法原样保留的值一律
 * 返回 null（见 serializeStringLiteral）。
 *
 * 不变量 / Invariants:
 * - 「已固化」判定按**见证身份（名字）逐条**比对：同名（同一调用点）不重复
 *   写；名字不同的**新调用点**照写 ⇒ 二次 freeze 追加新见证，不再因
 *   「函数上已有 case 指令」把新见证整条丢弃。
 * - 手写 case（非 call@ 命名）不动（hand-written）。
 * - **不可表达就不写**：实参表达不出（rest 槽 / 稀疏元组的洞 / fn / eff /
 *   brand / 不可承载的字符串）时整条放弃（null），不得静默近似成另一种
 *   形态（近似会把观测事实说反，见 tuple 洞位的 #561）。
 * - **写回只增不改**：新写的 JSDoc 块按**声明行的行首缩进**定位（不是
 *   函数节点的列），新行沿用**源文件的主导行尾**（CRLF 文件不混排）。
 * - **字节保真**：写回只动「该动的那几行」，其余字节原样搬运 ——
 *   ① UTF-8 BOM 仍留在**文件最前**（不随首行下移，也不被当缩进抄进新行）；
 *   ② 源文件的行尾约定不变（CRLF 文件写回后仍是纯 CRLF）；
 *   ③ 文件末尾有无换行不变（末尾无换行 ⇒ 写回后仍无换行）。
 * - **diff 与 native 同口径**：行模型区分「末行有/无终止符」，末行无终止符
 *   时输出 `\ No newline at end of file` 标记 ⇒ 产出的补丁可被 `git apply`
 *   接受；diff **按字节**呈现（BOM 留在首行内容里，native git 同形）⇒ 既
 *   贴得上补丁，也不把「BOM 被吃掉」这类真实字节改动藏成空 diff。
 */

/** 合成 case 的名字前缀；带此前缀的 @nudo:case 视为本模块生成物 */
const GENERATED_PREFIX = "call@";

/** 行首形如 ` * @nudo:case "call@…" (` 的指令行（整行都是指令内容） */
const GENERATED_CASE_LINE_REGEX = /^\s*\*?\s*@nudo:case\s+"(call@[^"]*)"/;

/** 合法裸写的对象键：JS 标识符 */
const IDENT_KEY_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** parseCaseArgExpr 能吃回去的数字字面量（科学计数法等不收） */
const NUMBER_LITERAL_REGEX = /^-?\d+(\.\d+)?$/;

/** 字符串值中会破坏指令行结构的字符：参数逗号切分 / 括号配对（冒号在值位置安全，键位置才禁） */
const UNSAFE_STRING_CHARS = /[,()[\]{}]/;

/** 对象键的额外禁用字符：键内冒号会让解析侧的 findTopLevelColon 错位 */
const UNSAFE_KEY_CHARS = /[,()[\]{}:]/;

/** 控制字符（含换行）：指令必须单行 */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * UTF-8 BOM（U+FEFF 零宽不换行空格）。
 *
 * BOM 是**编码标记**不是源码内容：它在文件最前，语义上等于「本文件是
 * UTF-8」。写回管线必须把它**单独保管**（读出 → 对不含 BOM 的正文做行级
 * 编辑 → 写回时放回文件最前），否则固化指令插在声明行之上会把首行整体
 * 下移 ⇒ BOM 落到文件中段（文件不再是「UTF-8 with BOM」，而变成「UTF-8
 * 文本里夹了一个 U+FEFF」）。
 *
 * 注意：JS 正则的 `\s` **包含 U+FEFF** ⇒ 缩进匹配必须用 `[ \t]`，否则
 * BOM 会被当成「缩进」抄进新插入的行。
 */
const BOM = "\uFEFF";

/** 拆出文件头的 BOM：[bom, 正文]（无 BOM 时 bom 为空串） */
function splitBom(source: string): [string, string] {
  return source.startsWith(BOM) ? [BOM, source.slice(BOM.length)] : ["", source];
}

/**
 * 字符串字面量 → 可被 parseCaseArgExpr 原样解析回去的带引号文本。
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

/** 单个 Abs → parseCaseArgExpr 可解析回去的表达式文本；不可表达返回 null */
export function serializeCaseArg(a: Abs): string | null {
  return serializeCaseArgB(a, new ProjectionBudget());
}

function serializeCaseArgB(a: Abs, budget: ProjectionBudget): string | null {
  // DESIGN-001：环 / 超深 → 不可表达（null）。case 文法无截断标记，null 是
  // 既有「不可序列化」信号（buildCaseDirective 随之整体放弃，不静默截断）。
  const stop = budget.enter(a);
  if (stop) return null;
  try {
    return serializeCaseArgInner(a, budget);
  } finally {
    budget.exit();
  }
}

function serializeCaseArgInner(a: Abs, budget: ProjectionBudget): string | null {
  const s = a.shape;
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      // String(-0)==="0" 会抹掉可观察的 -0（Object.is / 1/x）；必须字面保真
      const n = Object.is(v, -0) ? "-0" : String(v);
      return NUMBER_LITERAL_REGEX.test(n) ? n : null;
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "bigint") return null;
    if (typeof v === "string") return serializeStringLiteral(v);
    return null;
  }
  switch (s.k) {
    case "prim":
      if (s.type === "number") return "number()";
      if (s.type === "string") return "string()";
      if (s.type === "boolean") return "boolean()";
      return null;
    case "unknown":
    case "any":
      return "any()";
    case "never":
      return "never";
    case "sum": {
      const parts: string[] = [];
      for (const member of s.members) {
        const ser = serializeCaseArgB(member, budget);
        if (ser === null) return null;
        parts.push(ser);
      }
      return `union(${parts.join(", ")})`;
    }
    case "arr": {
      const el = serializeCaseArgB(s.element, budget);
      return el === null ? null : `array(${el})`;
    }
    case "tuple": {
      // rest 槽指令文法不可表达（与 fn/eff/brand 同口径）→ 整体不可序列化，
      // 不得静默截断成固定位前缀
      if (s.rest) return null;
      // 洞位（稀疏空槽）同样不可表达：case 实参文法没有空槽写法 ⇒ 整条放弃
      // （与 rest 槽同口径）。洞位的 elements[i] 是 undefAbs()，与「显式
      // undefined 元素」Abs 完全同形 ⇒ 序列化不可区分；静默近似成
      // `[1, undefined, 3]` 会把观测到的 sparse（`1 in a` = false）说成
      // dense（true）——固化把事实翻成了反面（#561）。
      if (s.holes && s.holes.length > 0) return null;
      const parts: string[] = [];
      for (const el of s.elements) {
        const ser = serializeCaseArgB(el, budget);
        if (ser === null) return null;
        parts.push(ser);
      }
      return `[${parts.join(", ")}]`;
    }
    case "obj": {
      const parts: string[] = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        const vs = serializeCaseArgB(slot.value, budget);
        if (vs === null) return null;
        const ks = serializeObjectKey(key);
        if (ks === null) return null;
        parts.push(`${ks}: ${vs}`);
      }
      return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
    }
    default:
      // fn / eff / brand：指令文法不可表达
      return null;
  }
}

/**
 * 组装单行 ` * @nudo:case "name" (a, b)` 指令文本（无尾换行）。
 * 任一实参不可序列化、或名字含双引号/换行（名字正则 `"([^"]+)"` 承载不了）→ 整体 null。
 */
export function buildCaseDirective(name: string, argsAbs: Abs[]): string | null {
  if (name.includes('"') || /[\r\n]/.test(name)) return null;
  const parts: string[] = [];
  for (const arg of argsAbs) {
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
  // BOM 单独保管：剥离**可能删掉首行**（BOM 就长在首行上）⇒ BOM 必须原样
  // 接回，否则「剥离 → 写回」会把文件头的 BOM 弄丢（#562）。
  const [bom, body] = splitBom(source);
  const lines = body.split("\n");
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
    source: bom + lines.filter((_, i) => !drop[i]).join("\n"),
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
  for (const { name, directives } of extractDirectivesQuiet(ast)) {
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
 * 一行的行首缩进（只认空格与制表符）。
 * 缩进基准 = 声明**语句**所在行的行首缩进：函数节点自身的列是 `function`
 * 关键字的列（`export function` = 7、`export default function` = 15），
 * 按它缩进会让新写的 JSDoc 块与声明脱节（#507）。
 */
function leadingIndent(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/**
 * 源文件的**主导行尾**（CRLF 计数 > 裸 LF 计数 ⇒ CRLF）。
 * 新插入的行按主导行尾写回 ⇒ CRLF 文件不会因固化变成混合行尾（#547）。
 */
function dominantEol(source: string): "\r\n" | "\n" {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * 把 analysis 中的合成 case（source === "callsite"）固化为源码指令：
 *
 * 1. 源码已有任何非 call@ 命名的 case → skip "hand-written"。
 * 2. fn.skipped / fn.noDeclaration / fn.entryOnly → 对应 skip。
 * 3. 逐 case 序列化；个别不可序列化的丢弃并在 skipped 记
 *    no-serializable-cases（函数整体仍写可序列化子集，全不可序列化才整函数跳过）。
 * 4. **已固化的见证按「见证身份（名字）」逐条比对**：同名（同一调用点）不
 *    重复写，新调用点照写——二次 freeze 不再因「函数上已有 case 指令」
 *    而静默丢弃新增调用点（本次固化全在 ⇒ skip "already-generated"）。
 * 5. 写入位置：函数声明行正上方——已有 JSDoc 块则插到 `/**` 行后，
 *    无块则新建三行块。缩进基准取**声明行的行首缩进**（不是
 *    FunctionDeclaration 节点的 loc.start.column——那是 `function` 关键字的
 *    列：`export function` = 7、`export default function` = 15，按它缩进会让
 *    整块右移、与列 0 的声明脱节）。多函数编辑按行号从下往上应用，避免
 *    行号漂移。
 * 6. 新插入的行沿用**源文件的主导行尾**（CRLF 文件写回后不得混入裸 LF）。
 */
export function insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult {
  const written: EmitResult["written"] = [];
  const skipped: EmitResult["skipped"] = [];
  // BOM 单独保管：对**不含 BOM** 的正文做行级编辑，写回时把 BOM 放回**文件
  // 最前** ⇒ 固化指令插在声明行之上时，首行（BOM 所在行）整体下移也不会
  // 把 BOM 带走（否则 BOM 落到文件中段：文件不再是「UTF-8 with BOM」，而是
  // 「UTF-8 文本里夹了一个 U+FEFF」，#562）。
  const [bom, body] = splitBom(source);
  const existing = collectExistingCases(body);

  type Edit = { line: number; column: number; directives: string[]; fn: string };
  const edits: Edit[] = [];

  for (const fn of analysis.functions) {
    const existingCases = existing.get(fn.name) ?? [];
    if (existingCases.some((c) => !c.name.startsWith(GENERATED_PREFIX))) {
      skipped.push({ fn: fn.name, reason: "hand-written" });
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
      skipped.push({
        fn: fn.name,
        reason: existingCases.length > 0 ? "already-generated" : "no-serializable-cases",
        ...(existingCases.length > 0 ? {} : { detail: "no callsite cases" }),
      });
      continue;
    }
    // 已固化的见证身份（名字）：同一调用点不重复写；新调用点照写。
    const existingNames = new Set(existingCases.map((c) => c.name));
    const built: string[] = [];
    const names: string[] = [];
    /** 本轮因「不可序列化」被丢弃的见证数（逐 case 已记 skip） */
    let dropped = 0;
    for (const c of callsiteCases) {
      if (existingNames.has(c.name)) continue;
      const directive = buildCaseDirective(c.name, c.argAbs ?? []);
      if (directive === null) {
        skipped.push({ fn: fn.name, reason: "no-serializable-cases", detail: `case ${c.name} not serializable` });
        dropped++;
      } else {
        built.push(directive);
        names.push(c.name);
      }
    }
    if (built.length === 0) {
      // 本轮无新见证可写：
      // - 见证**已固化**（同名）⇒ skip "already-generated"；
      // - 见证**不可序列化**⇒ 上面已逐 case 记 skip（不再叠一条
      //   "already-generated"——那会把「写不出来」说成「早就写过了」）。
      if (dropped === 0) {
        skipped.push({ fn: fn.name, reason: "already-generated" });
      }
      continue;
    }
    edits.push({ line: fn.loc.start.line, column: fn.loc.start.column, directives: built, fn: fn.name });
    written.push({ fn: fn.name, cases: names });
  }

  // 从下往上应用编辑
  edits.sort((a, b) => b.line - a.line);
  const lines = body.split("\n");
  // split("\n") 把 CRLF 的 "\r" 留在每行行尾 ⇒ 原行行尾无损复原（join 时补回
  // "\n"）；但**新插入的行是现造的**，不带 "\r" ⇒ CRLF 文件会变成混合行尾。
  // 新行按源文件的**主导行尾**补齐（CRLF 主导 ⇒ 新行带 "\r"）。
  //
  // 行尾口径（#547 新块用什么行尾 / #563 保留源文件原有行尾）：
  // - **既有行**：行尾逐行保留（split 留下的 "\r" 原样带过，join 时补 "\n"）
  //   ⇒ 写回不改写源文件的行尾约定；
  // - **新插入的行**：沿用**主导行尾**（CRLF 计数 > 裸 LF 计数 ⇒ CRLF）。
  // 若写盘层后续改成「逐行记录行尾 + 逐行还原」的模型，本处 eolTail 须并入
  // 那套模型（否则 "\r" 会重复一次）。
  const eolTail = dominantEol(body) === "\r\n" ? "\r" : "";
  for (const edit of edits) {
    const declIdx = edit.line - 1;
    // 缩进基准 = 声明行的行首缩进（声明**语句**的列），不是函数节点的列：
    // `export function` 的函数节点列是 7、`export default function` 是 15，
    // 按它缩进会让新块与声明脱节（#507）。
    const declLine = lines[declIdx];
    const indent = declLine === undefined ? " ".repeat(edit.column) : leadingIndent(declLine);

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
          // 缩进只认空格/制表符：`\s` 含 U+FEFF ⇒ BOM 会被当成缩进抄进新行
          blockIndent = leadingIndent(t);
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
      lines.splice(insertIdx, 0, ...edit.directives.map((d) => blockIndent + d + eolTail));
    } else {
      lines.splice(
        declIdx,
        0,
        `${indent}/**${eolTail}`,
        ...edit.directives.map((d) => indent + d + eolTail),
        `${indent} */${eolTail}`,
      );
    }
  }

  return {
    source: bom + lines.join("\n"),
    changed: written.length > 0,
    written,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// unified diff（行级 LCS，无第三方依赖）
// ---------------------------------------------------------------------------

/**
 * unified diff 的「末行无终止符」标记。
 * GNU diff 按 locale 翻译（中文环境是「\ 文件末尾没有换行符」），git diff 用
 * 固定英文串 ⇒ 补丁消费方（git apply / patch）只认后者。
 */
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/** diff 的一行：key = 比较键（含终止符信息），text = 输出用的行内容 */
type DiffLine = { key: string; text: string; terminated: boolean };

type DiffOp = {
  type: "equal" | "delete" | "insert";
  text: string;
  /** 该行在旧侧的行号（insert 为 -1） */
  aIdx: number;
  /** 该行在新侧的行号（delete 为 -1） */
  bIdx: number;
};

/**
 * diff 的行模型：按 "\n" 切行（CRLF 的 "\r" 留在**行内容**里 ⇒ 输出与 native
 * `diff -u` 一致），并记录每行**是否有终止符**：
 * - key 带上终止符 ⇒ 「a\n」与「a」是**不同的行**（native diff 同口径：末尾
 *   换行的有无本身就是内容差异）；
 * - 文件末尾没有换行时，末行没有终止符 ⇒ 输出 `\ No newline at end of file`；
 * - 「phantom 末行」（`split` 产生的末尾空串）**不算一行** ⇒ 行数不多算一格。
 */
function splitDiffLines(source: string): DiffLine[] {
  if (source === "") return [];
  const parts = source.split("\n");
  const endsWithNewline = parts.length > 1 && parts[parts.length - 1] === "";
  const real = endsWithNewline ? parts.slice(0, -1) : parts;
  return real.map((raw, i) => {
    const terminated = i < real.length - 1 || endsWithNewline;
    return { key: terminated ? `${raw}\n` : raw, text: raw, terminated };
  });
}

/** 行级 LCS：先裁公共前后缀把 DP 表压到真实差异窗口，再回溯产出操作序列 */
function diffOps(a: DiffLine[], b: DiffLine[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start]!.key === b[start]!.key) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1]!.key === b[endB - 1]!.key) {
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
        midA[i]!.key === midB[j]!.key
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ type: "equal", text: a[k]!.text, aIdx: k, bIdx: k });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i]!.key === midB[j]!.key) {
      ops.push({ type: "equal", text: midA[i]!.text, aIdx: start + i, bIdx: start + j });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      ops.push({ type: "delete", text: midA[i]!.text, aIdx: start + i, bIdx: -1 });
      i++;
    } else {
      ops.push({ type: "insert", text: midB[j]!.text, aIdx: -1, bIdx: start + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", text: midA[i]!.text, aIdx: start + i, bIdx: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "insert", text: midB[j]!.text, aIdx: -1, bIdx: start + j });
    j++;
  }
  // 公共后缀：两侧剩余长度可能不同 ⇒ 新侧行号要按差平移
  const shift = endA - endB;
  for (let k = endA; k < a.length; k++) {
    ops.push({ type: "equal", text: a[k]!.text, aIdx: k, bIdx: k - shift });
  }
  return ops;
}

const DIFF_CONTEXT = 3;

/** `@@ -1,3 +1,4 @@` 风格的范围描述；count 为 1 时省略 `,c`，为 0 时行号回退一行 */
function formatRange(start: number, count: number): string {
  const s = count === 0 ? start - 1 : start;
  return count === 1 ? `${s}` : `${s},${count}`;
}

/**
 * 行级 unified diff：`--- a/path` 头 + `@@` hunk + 上下文 3 行；相同返回 ""。
 *
 * 口径与 native `diff -u` / `git diff` 对齐：
 * - **字节保真**：BOM 留在首行的**行内容**里（native git 同形：上下文行是
 *   `﻿import …`）⇒ ① 产出的补丁能被 `git apply` 接受（git apply 按**字节**
 *   比对上下文 ⇒ 上下文里少一枚 BOM 就贴不上）；② 「BOM 被发射器吃掉」
 *   这类**真实**的字节改动不会被 diff 藏起来（把 BOM 剥掉再比 ⇒ 空 diff
 *   谎报「无改动」，而文件其实被重写了）。
 * - **末行没有终止符**时输出 `\ No newline at end of file` 标记 ⇒ 产出的补丁
 *   能被 `git apply` 接受（缺标记时 git apply 按「该行有换行」解释 ⇒ 上下文
 *   不匹配 ⇒ 补丁被拒，#564）。
 */
export function unifiedDiff(a: string, b: string, path: string): string {
  if (a === b) return "";
  const oldLines = splitDiffLines(a);
  const newLines = splitDiffLines(b);
  const ops = diffOps(oldLines, newLines);
  // 两侧逐行相同 ⇒ 没有内容差异（只有编码标记的差异也不算内容差异，但
  // 上面按字节比对 ⇒ BOM 的有无本身就是首行的差异）
  if (ops.every((op) => op.type === "equal")) return "";

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
  // 末行无终止符的行号（两侧各自算）：末行在 diff 里要带
  // `\ No newline at end of file` 标记。
  const oldLast = oldLines.length - 1;
  const newLast = newLines.length - 1;
  const oldNoEol = oldLines.length > 0 && !oldLines[oldLast]!.terminated;
  const newNoEol = newLines.length > 0 && !newLines[newLast]!.terminated;
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
      // 末行没有终止符 ⇒ 该行后面跟标记（与 native diff -u / git diff 同形）
      if (op.type === "delete" && op.aIdx === oldLast && oldNoEol) {
        out.push(NO_NEWLINE_MARKER);
      } else if (op.type === "insert" && op.bIdx === newLast && newNoEol) {
        out.push(NO_NEWLINE_MARKER);
      } else if (op.type === "equal" && op.aIdx === oldLast && op.bIdx === newLast && oldNoEol) {
        out.push(NO_NEWLINE_MARKER);
      }
    }
  }
  return out.join("\n") + "\n";
}
