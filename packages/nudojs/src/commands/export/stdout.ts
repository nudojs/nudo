/**
 * export — stdout 拼装与平铺：投影面文本上屏。
 *
 * 平铺顺序：zod 模块 → standard 块 → guard 块 → dts 块；末尾附 dropped preds
 * 说明（仅当有丢弃项）。
 *
 * stdout 是**一个** TS 模块作用域 ⇒ 四方言平铺进同一作用域有三条硬约束：
 *
 * - **601**：standard 的每个 per-function 模块都是**完整模块**（自带一份
 *   `__nudoCheck` helper + banner）⇒ 平铺 N 份 = N 次同名声明（TS2393 /
 *   TS2300）⇒ helper 前导**只发一次**（公共前导 = 各块逐字相同的前缀）。
 * - **602 / 603**：zod 段与 standard 段对同一函数用**同一命名模板**
 *   （`<fn>Input` / `<fn>Output`）⇒ 平铺进同一作用域必然撞名（TS2451）⇒
 *   跨段标识符去重（先到先得，后段改名）。
 * - **BUG-074**：dts 段是**`.d.ts` 上下文**的文本（`export default function
 *   f(…): T;` 无实现也无 `declare`）⇒ 平铺进普通 `.ts` 模块是 TS2391 /
 *   TS2390 ⇒ 上屏前改写成 ambient 形态（{@link ambientizeDtsSegment}；
 *   `--out` 落盘各段进 `.d.ts` 文件 ⇒ 不受影响）。
 *
 * ⚠ 跨段改名是 **stdout 流内**的去重（`--out` 落盘时各方言各占一个文件 ⇒
 * 无冲突 ⇒ 产物文件名与导出名**不受影响**）。
 *
 * **命名规则的唯一产地** = `export/io.ts`（`DIALECT_SUFFIX` + `uniqueSegmentName`
 * + `ArtifactDialect`）—— 族 17 收口时把本文件原先的本地副本删掉，改为
 * import，避免「stdout 改名规则」与「落盘改名规则」分叉。
 */

import { uniqueSegmentName, type ArtifactDialect } from "./io.ts";

/** 待上屏的投影面产物。 */
export type ExportStdoutParts = {
  /** zod 模块源码（缺席 = 无 schema 产物） */
  schemaSource?: string;
  /** standard 面函数块 */
  standardChunks: readonly string[];
  /** guard 面函数块 */
  guardChunks: readonly string[];
  /** dts 面模块块 */
  dtsChunks: readonly string[];
  /** 未能投影的谓词说明 */
  droppedNotes: readonly string[];
};

/** 一个方言段（= 一个产物面的一块文本）。 */
type StdoutSegment = {
  /** 段的方言标签 */
  dialect: ArtifactDialect;
  /** 段文本 */
  text: string;
};

/** 尾部台账的**来源面**：standard 面（droppedNotes 只由 standard 面产生）。 */
const DROPPED_PREDS_SURFACE = "standard";

/** standard 块的段标题行（`// === <fn> Standard Schema ===`）。 */
const STANDARD_SEGMENT_HEADER = /^\/\/ === .* Standard Schema ===$/;

/**
 * 顶层导出声明（生成产物的形状）：`export const` / `export function` /
 * `export declare function` / `export declare class` …
 */
const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/** 顶层再导出清单：`export { a, b as c } from "…";` */
const TOP_LEVEL_EXPORT_LIST = /^export\s*\{([^}]*)\}/;

/** import 的具名绑定：`import { z } from "zod";` */
const IMPORT_NAMED = /^[ \t]*import\s*(?:type\s+)?\{([^}]*)\}/;

/** import 的默认绑定：`import d from "…"` / `import d, { x } from "…"` */
const IMPORT_DEFAULT = /^[ \t]*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|from)/;

/** import 的命名空间绑定：`import * as ns from "…"` */
const IMPORT_NS = /^[ \t]*import\s*\*\s*as\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * 段内**顶层**标识符及其种类（BUG-075）。
 *
 * 平铺进同一模块作用域的所有顶层标识符必须互不冲突 —— 不只「导出声明」：
 * - `export` ⇒ 导出声明（用户 API 与生成器产品名都在这一类）；
 * - `local` ⇒ **非导出**声明（standard 段的 `__nudoCheck` / `NudoSchemaNode` …）；
 * - `import` ⇒ import 绑定（zod 段的 `import { z } from "zod"` 里的 `z`）。
 *
 * 旧实现只登记 `^export …` ⇒ `z` / `__nudoCheck` 这类绑定不在去重视野内 ⇒
 * 与用户导出名撞名时既不改名也不报错 ⇒ TS2440 + `z.object` 被解析到用户的
 * `z` 上（语义串味）。
 *
 * 只认**行首无缩进**的声明：生成产物的顶层声明都在第 0 列，嵌套（如
 * `__nudoCheck` 内的 `function push`）都带缩进 ⇒ 不需要花括号栈。
 */
type SegmentIdent = { name: string; kind: "export" | "local" | "import" };

function segmentIdentifiers(text: string): SegmentIdent[] {
  const out: SegmentIdent[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: SegmentIdent["kind"]): void => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind });
  };
  for (const line of text.split("\n")) {
    if (line.length === 0 || line.startsWith(" ") || line.startsWith("\t")) continue;
    const named = IMPORT_NAMED.exec(line);
    if (named !== null) {
      for (const part of named[1]!.split(",")) {
        const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        // 绑定名 = `as` 之后的本地名；无 `as` ⇒ 被导入名即本地名
        if (m !== null) push(m[2] ?? m[1]!, "import");
      }
    }
    const def = IMPORT_DEFAULT.exec(line);
    if (def !== null) push(def[1]!, "import");
    const ns = IMPORT_NS.exec(line);
    if (ns !== null) push(ns[1]!, "import");
    const decl = TOP_LEVEL_DECL.exec(line);
    if (decl !== null) push(decl[1]!, line.startsWith("export") ? "export" : "local");
    const list = TOP_LEVEL_EXPORT_LIST.exec(line);
    if (list !== null) {
      for (const part of list[1]!.split(",")) {
        const n = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (n !== undefined && n !== "") push(n, "export");
      }
    }
  }
  return out;
}

/** 标识符起始字符（`$` / `_` 也是标识符字符）。 */
function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

/** 标识符后续字符。 */
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

/** 引号字符串（`'…'` / `"…"`）的结束位置（不含）。 */
function skipQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return text.length;
}

/**
 * 模板字面量的结束位置（不含）。
 *
 * `${…}` 内的代码不参与改名 —— 产物里的模板字面量是**类型文本**
 * （`` `${number}${string}` ``）或消息文本，保真优先于改名。
 */
function skipTemplate(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && text[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        const c = text[j]!;
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === '"' || c === "'") {
          j = skipQuoted(text, j, c);
          continue;
        }
        if (c === "`") {
          j = skipTemplate(text, j);
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return text.length;
}

/** 下一个非空白 / 非注释字符（判 `id:` 形态用）。 */
function nextSignificant(text: string, start: number): string {
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const k = text.indexOf("\n", i);
      if (k < 0) return "";
      i = k;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const k = text.indexOf("*/", i + 2);
      if (k < 0) return "";
      i = k + 2;
      continue;
    }
    return ch;
  }
  return "";
}

/** `{` 开启的是**对象字面量**（其内 `id:` 是键、不是引用）？ */
function isObjectBraceStart(prevSig: string, prevWord: string): boolean {
  if (prevWord === "return" || prevWord === "yield") return true;
  return (
    prevSig === "" ||
    prevSig === "=" ||
    prevSig === "(" ||
    prevSig === "," ||
    prevSig === ":" ||
    prevSig === "[" ||
    prevSig === "?"
  );
}

/** 代码区的标识符改名（词法感知：跳过字面量 / 注释 / 属性键）。 */
function renameCode(text: string, from: string, to: string): string {
  const out: string[] = [];
  /** 花括号栈：true = 对象字面量（其内 `id:` 是键） */
  const braces: boolean[] = [];
  let prevSig = "";
  let prevWord = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const k = text.indexOf("\n", i);
      const end = k < 0 ? text.length : k;
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const k = text.indexOf("*/", i + 2);
      const end = k < 0 ? text.length : k + 2;
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipQuoted(text, i, ch);
      out.push(text.slice(i, end));
      i = end;
      prevSig = ch;
      prevWord = "";
      continue;
    }
    if (ch === "`") {
      const end = skipTemplate(text, i);
      out.push(text.slice(i, end));
      i = end;
      prevSig = "`";
      prevWord = "";
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j]!)) j++;
      const word = text.slice(i, j);
      const next = nextSignificant(text, j);
      // 属性访问（`obj.key`）与对象字面量的键不是**绑定**，不能改名
      const isProp = prevSig === ".";
      const isKey =
        next === ":" &&
        prevSig !== "?" &&
        braces.length > 0 &&
        braces[braces.length - 1] === true;
      out.push(word === from && !isProp && !isKey ? to : word);
      i = j;
      prevSig = "id";
      prevWord = word;
      continue;
    }
    if (ch === "{") {
      braces.push(isObjectBraceStart(prevSig, prevWord));
      out.push(ch);
      i++;
      prevSig = ch;
      prevWord = "";
      continue;
    }
    if (ch === "}") {
      braces.pop();
      out.push(ch);
      i++;
      prevSig = ch;
      prevWord = "";
      continue;
    }
    out.push(ch);
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
      prevSig = ch;
      prevWord = "";
    }
    i++;
  }
  return out.join("");
}

/** import 语句整体（这块区域由 {@link renameImportBinding} 处理，扫描时跳过）。 */
const IMPORT_SPAN = /^[ \t]*import\b[\s\S]*?;[ \t]*$/gm;

/**
 * import 子句里**本地绑定**改名：`{ z }` → `{ z as zZod }`、
 * `{ z as x }` → `{ z as zZod }`。
 *
 * 直接把**被导入名**换掉会指向一个不存在的模块导出 ⇒ 只能加别名。
 */
function renameImportBinding(text: string, from: string, to: string): string {
  return text.replace(
    /^([ \t]*import\s*(?:type\s+)?\{)([^}]*)(\})/gm,
    (whole: string, head: string, body: string, tail: string) => {
      let hit = false;
      const parts = body.split(",").map((part) => {
        const raw = part.trim();
        if (raw === "") return part;
        const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(raw);
        if (m === null) return part;
        const imported = m[1]!;
        const local = m[2] ?? imported;
        if (local !== from) return part;
        hit = true;
        return part.replace(raw, `${imported} as ${to}`);
      });
      return hit ? `${head}${parts.join(",")}${tail}` : whole;
    },
  );
}

/**
 * 段内标识符改名（**词法感知**，BUG-204）：只改绑定与引用 —— 字符串 /
 * 模板字面量 / 注释 / 属性访问（`obj.key`）/ 对象字面量的键一律不动。
 *
 * 旧实现是**裸文本替换**（只判标识符边界）⇒ standard 段
 * `__nudoCheck({"k":"obj","slots":[{"key":"f1Input",…}]})` 里那个**数据**
 * （槽键）被一起改名 ⇒ 导出的 schema 要求一个根本不存在的形参名，而同一
 * 产物里的 zod 段 / dts 段仍用原名 ⇒ 同一产物内两面裁决相反。
 */
function renameIdentifier(text: string, from: string, to: string): string {
  const aliased = renameImportBinding(text, from, to);
  const out: string[] = [];
  let last = 0;
  for (const m of aliased.matchAll(IMPORT_SPAN)) {
    const start = m.index ?? 0;
    out.push(renameCode(aliased.slice(last, start), from, to));
    out.push(m[0]);
    last = start + m[0].length;
  }
  out.push(renameCode(aliased.slice(last), from, to));
  return out.join("");
}

/** standard 块 → 段标题行 + 模块行（模块行 = banner + helper + 导出体）。 */
function splitStandardChunk(chunk: string): { head: string[]; module: string[] } {
  const lines = chunk.split("\n");
  const idx = lines.findIndex((l) => STANDARD_SEGMENT_HEADER.test(l));
  if (idx < 0) return { head: [], module: lines };
  return { head: lines.slice(0, idx + 1), module: lines.slice(idx + 1) };
}

/** 各块模块行的公共前缀（banner + helper 逐字相同 ⇒ 前缀即前导）。 */
function commonPrefixLines(modules: readonly string[][]): string[] {
  if (modules.length === 0) return [];
  let prefix = modules[0]!.slice();
  for (let k = 1; k < modules.length; k++) {
    const m = modules[k]!;
    let i = 0;
    while (i < prefix.length && i < m.length && prefix[i] === m[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/**
 * standard 各块的公共前导（banner + helper）行数。
 *
 * **不得越过首个导出体行**（`export const ` 开头）：两个同形导出体（同名函
 * 数）会让公共前缀吃进导出体 ⇒ 那里本来就是撞名（另一族 bug，不在本片）。
 *
 * 前导 = 0（各块前导不同源，理论上不会发生）⇒ 不剥任何内容（宁可重复声明也
 * 不丢内容）。
 */
function preludeLineCount(modules: readonly string[][]): number {
  let n = commonPrefixLines(modules).length;
  for (const m of modules) {
    const first = m.findIndex((l) => l.startsWith("export const "));
    if (first >= 0) n = Math.min(n, first);
  }
  return n;
}

/**
 * standard 块 → 方言段：**前导只发一次**（601）。
 *
 * 第一块保留完整前导（banner + helper），其余块剥掉前导 ⇒ 同一 stdout 流里
 * helper 只声明一次（`--out` 落盘时每函数一份文件 ⇒ 各带一份 helper，互不
 * 冲突 ⇒ 不受影响）。
 */
function standardSegments(chunks: readonly string[]): StdoutSegment[] {
  const split = chunks.map(splitStandardChunk);
  const prelude = preludeLineCount(split.map((s) => s.module));
  return split.map((s, i) => ({
    dialect: "standard" as const,
    text: [...s.head, ...(i === 0 ? s.module : s.module.slice(prelude))].join("\n"),
  }));
}

/** `export default function|class <name>`（dts 生成器的 default 导出形态）。 */
const DEFAULT_EXPORT_DECL = /^export default (function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * dts 段 → **普通模块作用域**的合法形态（BUG-074）。
 *
 * dts 生成器写的是 **`.d.ts` 上下文**：具名导出带 `declare`（合法），但
 * `default` 导出写成 `export default function f(…): T;`——**既无实现也无
 * `declare`** ⇒ 平铺进 stdout 这个**普通 `.ts` 模块**就是 TS2391（函数声明缺
 * 实现）/ TS2390（类同理）。`--out` 落盘时各段各进 `.d.ts` 文件 ⇒ 合法，
 * **缺陷只在 stdout 平铺面**。
 *
 * 改写成 ambient 形态（`export default declare` 不是合法 TS，故拆两步）：
 * - `export default function f(…)` ⇒ `declare function f(…)` + `export { f as default };`
 * - `export default class C {…}`  ⇒ `declare class C {…}`  + `export { C as default };`
 *
 * 导出语句追加在段尾（同名声明已在该模块作用域内；一个模块至多一个
 * `default` 导出，防御性地逐条追加）。
 */
function ambientizeDtsSegment(text: string): string {
  const lines = text.split("\n");
  const defaultNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = DEFAULT_EXPORT_DECL.exec(line);
    if (!m) continue;
    lines[i] = `declare ${m[1]} ${m[2]}${line.slice(m[0].length)}`;
    defaultNames.push(m[2]!);
  }
  if (defaultNames.length === 0) return text;
  return [...lines, ...defaultNames.map((n) => `export { ${n} as default };`)].join("\n");
}

/** stdout 流的方言段（有序：zod → standard → guard → dts）。 */
function stdoutSegments(parts: ExportStdoutParts): StdoutSegment[] {
  const segments: StdoutSegment[] = [];
  if (parts.schemaSource !== undefined) segments.push({ dialect: "zod", text: parts.schemaSource });
  segments.push(...standardSegments(parts.standardChunks));
  for (const g of parts.guardChunks) segments.push({ dialect: "guard", text: g });
  for (const d of parts.dtsChunks) {
    segments.push({ dialect: "dts", text: ambientizeDtsSegment(d) });
  }
  return segments;
}

/** stdout 组装结果：上屏的块 + standard 段的跨段改名表。 */
type StdoutAssembly = {
  /** 上屏的块（有序） */
  chunks: string[];
  /** standard 段的跨段改名（原名 → 新名）——台账条目同源改名 */
  standardRenames: Map<string, string>;
};

/**
 * stdout 组装：段 → 跨段标识符去重（602 / 603 / BUG-028 / BUG-075 / BUG-204）
 * → 上屏块。
 *
 * 去重口径（**用户 API 优先**）：
 * - **用户 API 名**（dts 段 = 模块面：`export declare function foo` …）**先预留**
 *   ⇒ 任何方言段都不得占用用户导出名。旧口径「先到先得」让 zod 段生成的
 *   `<fn>Input` / `<fn>Output` 直接占了用户的同名导出（`xxxInput` 是极常见的
 *   命名）⇒ 用户 API 被改名成 `fooInputDts`，而那个名字只存在于 stdout 产物
 *   （`--out` 落盘时各段各占一个文件 ⇒ 名字不变）⇒ 同一命令两条投递路径给出
 *   两份不同的公开 API（BUG-028）；
 * - **生成器段内的绑定**（导出名 / import 绑定）⇒ 撞名时**工具让位**
 *   （`<原名><方言后缀>`，仍占用则加数字后缀）：`z` 段让位为 `zZod`、
 *   `fooInput` 让位为 `fooInputStandard`。改名走 {@link renameIdentifier}
 *   （词法感知），不动字符串里的**数据**（standard 段的槽键，BUG-204）；
 * - **跨段 helper**（standard 段前导里的非导出声明：`__nudoCheck` …，只发一次、
 *   其余段仍按旧名引用）⇒ 无法就地改名 ⇒ 由**用户侧让位**
 *   （`<原名>Dts`，BUG-075）。
 */
function assembleStdout(parts: ExportStdoutParts): StdoutAssembly {
  const segments = stdoutSegments(parts);
  const standardRenames = new Map<string, string>();

  // 用户 API 名（dts 段 = 模块面）先预留（BUG-028）
  const userNames = new Set<string>();
  for (const seg of segments) {
    if (seg.dialect !== "dts") continue;
    for (const id of segmentIdentifiers(seg.text)) userNames.add(id.name);
  }
  const used = new Set<string>(userNames);
  /** 用户导出名被**跨段 helper** 占用 ⇒ 只能用户侧让位（BUG-075） */
  const userRenames = new Map<string, string>();

  const chunks: string[] = [];
  for (const seg of segments) {
    let text = seg.text;
    for (const { name, kind } of segmentIdentifiers(text)) {
      if (seg.dialect === "dts") continue; // 用户 API 名恒占（已预留）
      if (!used.has(name)) {
        used.add(name);
        continue;
      }
      if (kind === "local") {
        // 跨段 helper：改名会漏（其余段仍按旧名引用）⇒ 用户侧让位
        const userNext = uniqueSegmentName(name, "dts", used);
        userRenames.set(name, userNext);
        used.add(userNext);
        continue;
      }
      // 段内绑定（导出名 / import 绑定）：工具让位
      const next = uniqueSegmentName(name, seg.dialect, used);
      text = renameIdentifier(text, name, next);
      used.add(next);
      if (seg.dialect === "standard") standardRenames.set(name, next);
    }
    chunks.push(text);
  }

  if (userRenames.size > 0) {
    segments.forEach((seg, k) => {
      if (seg.dialect !== "dts") return;
      let text = chunks[k]!;
      for (const [from, to] of userRenames) text = renameIdentifier(text, from, to);
      chunks[k] = text;
    });
  }

  return { chunks, standardRenames };
}

/**
 * 投影面文本块（有序）：zod → standard → guard → dts。
 *
 * 每块**独立**上屏（各自一行尾换行）——不是拼成一个大字符串。
 */
export function stdoutChunks(parts: ExportStdoutParts): string[] {
  return assembleStdout(parts).chunks;
}

/**
 * dropped preds 说明块（无丢弃项 ⇒ 无块）。
 *
 * 标题按**来源面**取名（standard）——不是按 schema 方言（恒 "zod"）：台账内容
 * 来自 standard 面的 dropped 记录，标题恒称 zod 会让 `--format standard`
 * （根本没产 zod 产物）也宣称「not projected into zod」（Bug 1050）。
 */
export function droppedPredsBlock(
  droppedNotes: readonly string[],
  surface: string = DROPPED_PREDS_SURFACE,
): string[] {
  if (droppedNotes.length === 0) return [];
  return [
    `\n// dropped preds (not projected into ${surface}):`,
    ...droppedNotes.map((n) => `//   ${n}`),
  ];
}

/** 投影面上屏（各块独立 `console.log`）。 */
export function printExportStdout(parts: ExportStdoutParts): void {
  const { chunks, standardRenames } = assembleStdout(parts);
  for (const chunk of chunks) {
    console.log(chunk);
  }
  // 台账条目与 standard 段的改名同源（改名后的导出名要对得上）
  const notes = parts.droppedNotes.map((n) => {
    let out = n;
    for (const [from, to] of standardRenames) out = renameIdentifier(out, from, to);
    return out;
  });
  for (const line of droppedPredsBlock(notes)) {
    console.log(line);
  }
}
