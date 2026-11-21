/**
 * TS 声明类型文本 → Abs 形状（Bug 479 / BUG-036）。
 *
 * 剥除 pass 留下的旁路是**源码文本**（`string` / `number[]` /
 * `{ a: number }` / `string | number`）。这里把 TS **内建复合类型**也映射成
 * Abs 形状：数组 / 元组 / 对象字面量 / 联合。此前只认 5 个 primitive，其余
 * 一律不映射 ⇒ 入口形参退「无约束 any」，`x.length` / `String(x)` 这类在
 * **合法 TypeScript 里保证不抛**的操作被记成 `nudo:entry-may-throw`（L2
 * 假红），而 dts 面同一注解完整保留 ⇒ 两面互相矛盾。
 *
 * 口径：
 * - 只映射结构可表达的形态；别名 / 泛型实例化 / 条件类型 / 映射类型 /
 *   交叉类型等仍不映射（⇒ 回落 any，不猜）；
 * - 嵌套位递归映射，**任一位不可映射 ⇒ 整条不映射**（半映射会把声明域
 *   悄悄收窄，比不映射更危险）；
 * - `null` / `undefined` / `void` 是**值**不是结构：Abs 用「unknown 形状 +
 *   lit term」表达，Shape 表达不了 ⇒ 只有 Abs 面（{@link absTypeForTsTypeText}）
 *   映射它们；Shape 面（{@link absShapeForTsTypeText}）保持旧口径不映射。
 */
import { abs, type Abs, type Shape } from "../abs.ts";
import { relationFn } from "../abs-fn.ts";
import { parseSource } from "../parse-source.ts";
import { lit, v, type Term } from "../term.ts";

/** 形状 → 嵌套位用的 Abs（无 term / pred：声明域，不是求值观测） */
function absOf(shape: Shape): Abs {
  return abs(shape, undefined, undefined, "exact");
}

/**
 * `null` / `undefined` / `void` 的 Abs：**unknown 形状 + lit term**。
 *
 * 这是 Abs 表达 nullish 字面量的唯一形态（`$lit(null)` 同款）：shape 侧没有
 * 值令牌，字面量精度只能由 term 承载。
 *
 * 为什么不能落 undefined（旧口径整条不映射）：`string | null` / `number |
 * undefined` 是 TS 里最常见的可空写法，整条不映射 ⇒ 入口落 **any** ⇒
 * check 签名 / `--json` / LSP hover / dts 返回位 / zod / guard 五面同时失真，
 * 而同一份产物里的 `@param x - string | null` 仍印注解原文（自相矛盾）。
 *
 * 为什么不是裸 `{ k: "unknown" }`：那个令牌表示**推断失败**（check 的
 * `isTrueUnknownAbs` 只看有没有 term）⇒ 会对用户写明的类型误报
 * `nudo:unknown-inference`。
 */
function nullishAbs(value: null | undefined): Abs {
  return abs({ k: "unknown" }, { op: "lit", value } as Term, undefined, "exact");
}

/** 元素域并集（变长位降级用）：同形去重；单成员直接返回，避免退化 sum。 */
function joinAbsList(list: Abs[]): Abs {
  const unique: Abs[] = [];
  const seen = new Set<string>();
  for (const a of list) {
    const key = JSON.stringify({ shape: a.shape, term: a.term });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }
  return unique.length === 1
    ? unique[0]!
    : abs({ k: "sum", members: unique }, undefined, undefined, "exact");
}

/** 括号记账：`>` 只有在不是 `=>` 的尾字符时才是闭合泛型实参的尖括号 */
function isCloseBracket(text: string, i: number): boolean {
  const ch = text[i];
  return ch === ")" || ch === "]" || ch === "}" || (ch === ">" && text[i - 1] !== "=");
}

/** 去掉包裹整条类型的括号（`(A | B)[]` 的内层括号不能误剥） */
function unwrapParens(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let wrapped = true;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
      else if (isCloseBracket(t, i)) depth--;
      if (depth === 0 && i < t.length - 1) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * 顶层分隔符切分（忽略 `<>` / `()` / `[]` / `{}` 与字符串里的分隔符）。
 * 数组后缀 `T[]`、泛型实参 `Record<string, number>` 里的逗号不能误切。
 *
 * 箭头函数 `=>` 的 `>` 是**运算符**，不是闭合括号（与 dts-generator.ts 的
 * 同名实现同一条守卫）：把它当闭合会把 depth 压成负数，之后的 `,` / `:`
 * 全部不算顶层 ⇒ `{ m: () => number, k: number }` 只切出一个成员，整个成员面
 * 被吞掉（连普通数据属性 `k` 一起）。
 */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== "") {
      cur += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (isCloseBracket(text, i)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 对象类型的键（去引号 / readonly / ?）；不可静态命名的键 ⇒ undefined */
function objectKeyOf(raw: string): { key: string; optional: boolean } | undefined {
  let k = raw.trim().replace(/^readonly\s+/, "");
  let optional = false;
  if (k.endsWith("?")) {
    optional = true;
    k = k.slice(0, -1).trim();
  }
  if (/^["'`]/.test(k)) {
    const quote = k[0]!;
    k = k.slice(1);
    if (k.endsWith(quote)) k = k.slice(0, -1);
  }
  return /^[A-Za-z_$][\w$]*$/.test(k) ? { key: k, optional } : undefined;
}

/**
 * 同文件具名类型声明（interface / type alias）→ 类型文本。
 *
 * BUG-247：入口注解 `o: Opts` 的 `Opts` 在同一文件里有声明，TS 语义就是
 * 结构化对象域；文本映射器只吃文本，所以这里先把声明面摊平成文本。
 * 带类型参数的声明（`interface Box<T>`）不展开——替换类型参数不在本层做。
 */
const namedTypeTextMemo = new Map<string, ReadonlyMap<string, string>>();
const NAMED_TYPE_TEXT_MEMO_MAX = 8;

export function namedTypeTextsForSource(source: string): ReadonlyMap<string, string> {
  const hit = namedTypeTextMemo.get(source);
  if (hit) return hit;
  const out = new Map<string, string>();
  try {
    const ast = parseSource(source, { keepTs: true }) as unknown as {
      program: { body: Array<Record<string, unknown>> };
    };
    for (const raw of ast.program.body) {
      const stmt =
        raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
          ? ((raw.declaration as Record<string, unknown> | undefined) ?? raw)
          : raw;
      const type = stmt.type;
      const id = stmt.id as { name?: string } | undefined;
      if (!id?.name) continue;
      if (stmt.typeParameters) continue;
      if (type === "TSInterfaceDeclaration") {
        const body = stmt.body as { start?: number; end?: number } | undefined;
        if (typeof body?.start !== "number" || typeof body.end !== "number") continue;
        out.set(id.name, `{${source.slice(body.start + 1, body.end - 1)}}`);
      } else if (type === "TSTypeAliasDeclaration") {
        const ann = stmt.typeAnnotation as { start?: number; end?: number } | undefined;
        if (typeof ann?.start !== "number" || typeof ann.end !== "number") continue;
        out.set(id.name, source.slice(ann.start, ann.end));
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（调用方按旧路径回落 any，不猜）
  }
  if (namedTypeTextMemo.size >= NAMED_TYPE_TEXT_MEMO_MAX) {
    const oldest = namedTypeTextMemo.keys().next().value;
    if (oldest !== undefined) namedTypeTextMemo.delete(oldest);
  }
  namedTypeTextMemo.set(source, out);
  return out;
}

/** 具名类型引用 → 声明文本（链式别名最多展开 8 层；不可解析 ⇒ 原文本）。 */
export function resolveNamedTypeText(
  text: string | undefined,
  namedTypes: ReadonlyMap<string, string> | undefined,
): string | undefined {
  let t = text?.trim();
  if (!t || !namedTypes) return t;
  const seen = new Set<string>();
  while (/^[A-Za-z_$][\w$]*$/.test(t) && namedTypes.has(t) && !seen.has(t) && seen.size < 8) {
    seen.add(t);
    t = namedTypes.get(t)!.trim();
  }
  return t;
}

/** 字符串字面量的值（双引号走 JSON，单引号只剥引号与常见转义）。 */
function stringLiteralValue(raw: string): string | undefined {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return undefined;
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/\\(['"\\])/g, "$1");
  }
  return undefined;
}

/** 数值字面量（十进制 / 十六 / 八 / 二 / BigInt / 数字分隔符）。 */
function numericLiteralValue(raw: string): number | bigint | undefined {
  let t = raw.trim();
  let negative = false;
  if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  }
  const big = t.endsWith("n");
  if (big) t = t.slice(0, -1);
  const clean = t.replace(/_/g, "");
  if (!/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(clean)) {
    return undefined;
  }
  if (big) {
    if (!/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)$/.test(clean)) return undefined;
    let value: bigint;
    try {
      value = BigInt(clean);
    } catch {
      return undefined;
    }
    return negative ? -value : value;
  }
  const value = Number(clean);
  if (!Number.isFinite(value)) return undefined;
  return negative ? -value : value;
}

/** 字面量类型 → 带 lit term 的 Abs（值域精度；不可识别 ⇒ undefined）。 */
function literalAbsOf(raw: string): Abs | undefined {
  const t = raw.trim();
  if (t === "true" || t === "false") {
    return abs({ k: "prim", type: "boolean" }, lit(t === "true"), undefined, "exact");
  }
  if (t.startsWith('"') || t.startsWith("'")) {
    const value = stringLiteralValue(t);
    return value === undefined
      ? undefined
      : abs({ k: "prim", type: "string" }, lit(value), undefined, "exact");
  }
  const num = numericLiteralValue(t);
  if (num === undefined) return undefined;
  return abs(
    { k: "prim", type: typeof num === "bigint" ? "bigint" : "number" },
    lit(num),
    undefined,
    "exact",
  );
}

/** 元组位：剥元素标签（`x: number` / `y?: string` / `...rest: T[]`）。 */
function tuplePartOf(
  raw: string,
): { text: string; rest: boolean; optional: boolean } {
  let text = raw.trim();
  let rest = false;
  if (text.startsWith("...")) {
    rest = true;
    text = text.slice(3).trim();
  }
  let optional = false;
  const idx = splitTopLevel(text, ":");
  if (idx.length === 2) {
    const label = idx[0]!.trim();
    const bare = label.replace(/\?$/, "");
    if (/^[A-Za-z_$][\w$]*$/.test(bare)) {
      optional = label.endsWith("?");
      text = idx[1]!.trim();
    }
  }
  if (text.endsWith("?")) {
    optional = true;
    text = text.slice(0, -1).trim();
  }
  return { text, rest, optional };
}

/** 函数类型形参表 → (名字, 类型, 可选) 三元组；`this` 位跳过。 */
function fnParamsOf(
  text: string,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): { names: string[]; types: Abs[]; optional: boolean[] } | undefined {
  const names: string[] = [];
  const types: Abs[] = [];
  const optional: boolean[] = [];
  const parts = text.trim() === "" ? [] : splitTopLevel(text, ",").map((p) => p.trim());
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]!;
    if (part === "") continue;
    const rest = part.startsWith("...");
    if (rest) part = part.slice(3).trim();
    let nameText = part;
    let typeText: string | undefined;
    const idx = splitTopLevel(part, ":");
    if (idx.length === 2) {
      nameText = idx[0]!.trim();
      typeText = idx[1]!.trim();
    }
    const opt = !rest && nameText.endsWith("?");
    const name = nameText.replace(/\?$/, "").trim();
    if (name === "this") continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
    const mapped = typeText === undefined ? absOf({ k: "any" }) : mapTsType(typeText, allowNullish, typeParams);
    if (!mapped) return undefined;
    names.push(name);
    types.push(mapped);
    optional.push(opt);
  }
  return { names, types, optional };
}

/** 函数类型 `(x: number) => string` → fn Abs；非函数类型 ⇒ null。 */
function functionTypeAbs(
  text: string,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): Abs | null | undefined {
  const t = unwrapParens(text.trim());
  let depth = 0;
  let quote = "";
  let arrow = -1;
  for (let i = 0; i < t.length - 1; i++) {
    const ch = t[i]!;
    if (quote !== "") {
      if (ch === quote && t[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (isCloseBracket(t, i)) depth--;
    if (depth === 0 && ch === "=" && t[i + 1] === ">") {
      arrow = i;
      break;
    }
  }
  if (arrow < 0) return null;
  let left = t.slice(0, arrow).trim();
  const right = t.slice(arrow + 2).trim();
  if (left.startsWith("new ")) left = left.slice(4).trim();
  if (!left.startsWith("(") || !left.endsWith(")")) return undefined;
  const params = fnParamsOf(left.slice(1, -1), allowNullish, typeParams);
  if (!params) return undefined;
  const returnType = mapTsType(right, allowNullish, typeParams);
  if (!returnType) return undefined;
  // 对象槽里的函数值走成员调用面时会读 impl（exec/class/invoke.ts 的
  // invokePropertyValue）⇒ 用 relationFn 同时写 shape 与 relation 实现。
  return relationFn(
    params.types,
    returnType,
    { params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)) },
  );
}

/** 方法签名 `m(x: number): string` → fn Abs；非方法形态 ⇒ null。 */
function methodMemberAbs(
  head: string,
  returnText: string,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): { abs: Abs; optional: boolean } | null | undefined {
  const open = head.indexOf("(");
  if (open <= 0 || !head.endsWith(")")) return null;
  const key = objectKeyOf(head.slice(0, open));
  if (!key) return undefined;
  const params = fnParamsOf(head.slice(open + 1, -1), allowNullish, typeParams);
  if (!params) return undefined;
  const returnType = mapTsType(returnText, allowNullish, typeParams);
  if (!returnType) return undefined;
  return {
    optional: key.optional,
    abs: relationFn(
      params.types,
      returnType,
      { params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)) },
    ),
  };
}

/** 索引签名 `[k: string]: number` → (key, value)；非索引签名 ⇒ null。 */
function indexSignatureOf(
  text: string,
  valueText: string,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): { key: Abs; value: Abs } | null | undefined {
  const t = text.trim().replace(/^readonly\s+/, "");
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const inner = t.slice(1, -1);
  const idx = splitTopLevel(inner, ":");
  if (idx.length !== 2) return undefined;
  // `[k: string]`：冒号左侧是索引参数名，右侧才是键类型。
  const key = mapTsType(idx[1]!.trim(), allowNullish, typeParams);
  const value = mapTsType(valueText.trim(), allowNullish, typeParams);
  if (!key || !value) return undefined;
  return { key, value };
}

/** `keyof T` → 键字面量联合（对象 / 元组 / 数组；其余不映射）。 */
function keyofAbs(text: string, allowNullish: boolean, typeParams?: ReadonlyMap<string, Abs>): Abs | null | undefined {
  const m = /^keyof\s+([\s\S]+)$/.exec(text.trim());
  if (!m) return null;
  const operand = mapTsType(m[1]!, allowNullish, typeParams);
  if (!operand) return undefined;
  const s = operand.shape;
  if (s.k === "obj") {
    const keys = Object.keys(s.slots);
    if (s.index) {
      return joinAbsList([
        ...keys.map((k) => literalAbsOf(JSON.stringify(k))!),
        absOf({ k: "prim", type: "string" }),
        absOf({ k: "prim", type: "number" }),
      ]);
    }
    if (keys.length === 0) return absOf({ k: "never" });
    return joinAbsList(keys.map((k) => literalAbsOf(JSON.stringify(k))!));
  }
  if (s.k === "tuple" || s.k === "arr") {
    return joinAbsList([absOf({ k: "prim", type: "number" }), absOf({ k: "prim", type: "string" })]);
  }
  return undefined;
}

/** 索引访问 `{ a: number }["a"]` / `[string, number][0]` → 成员域。 */
function indexedAccessAbs(text: string, allowNullish: boolean, typeParams?: ReadonlyMap<string, Abs>): Abs | null | undefined {
  const t = text.trim();
  if (!t.endsWith("]")) return null;
  let depth = 0;
  let quote = "";
  let open = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quote !== "") {
      if (ch === quote && t[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === "]") {
      depth--;
    } else if (ch === "{" || ch === "(" || ch === "<") depth++;
    else if (isCloseBracket(t, i)) depth--;
  }
  if (open <= 0 || depth !== 0) return null;
  const baseText = t.slice(0, open).trim();
  const idxText = t.slice(open + 1, -1).trim();
  if (baseText === "" || idxText === "") return null;
  const base = mapTsType(baseText, allowNullish, typeParams);
  // 基类型不可映射不说明「这是索引访问」：`readonly [A, B]` 的最后一个
  // `[` 也会走到这里，必须放行给后续的元组 / readonly 分支。
  if (!base) return null;
  const idx = idxText === "number"
    ? absOf({ k: "prim", type: "number" })
    : idxText === "string"
      ? absOf({ k: "prim", type: "string" })
      : literalAbsOf(idxText);
  if (!idx) return undefined;
  const bs = base.shape;
  const is = idx.shape;
  if (bs.k === "obj") {
    if (is.k === "prim" && is.type === "string" && idx.term?.op === "lit" && typeof idx.term.value === "string") {
      const slot = bs.slots[idx.term.value];
      if (slot) return slot.value;
      return bs.index?.value;
    }
    if (is.k === "prim" && (is.type === "string" || is.type === "number")) {
      if (bs.index) return bs.index.value;
      const vals = Object.values(bs.slots).map((s) => s.value);
      return vals.length > 0 ? joinAbsList(vals) : undefined;
    }
    return undefined;
  }
  if (bs.k === "tuple") {
    if (is.k === "prim" && is.type === "number" && idx.term?.op === "lit" && typeof idx.term.value === "number") {
      const i = idx.term.value;
      if (Number.isInteger(i) && i >= 0) {
        if (i < bs.elements.length) return bs.elements[i];
        return bs.rest;
      }
      return undefined;
    }
    if (is.k === "prim" && is.type === "number") {
      return joinAbsList([...bs.elements, ...(bs.rest ? [bs.rest] : [])]);
    }
    return undefined;
  }
  if (bs.k === "arr") {
    return is.k === "prim" && is.type === "number" ? bs.element : undefined;
  }
  return undefined;
}

/**
 * 声明类型文本 → Abs（不可映射 ⇒ undefined）。
 *
 * `allowNullish` 决定 `null` / `undefined` / `void` 怎么处理：
 * - `true`（Abs 面）：映成 nullish 字面量 Abs（见 {@link nullishAbs}）；
 * - `false`（Shape 面）：返回 undefined，保住 Shape 消费者的旧口径
 *   （它们拿不到 term，会把 nullish 误读成「推断失败」）。
 */
/** 显式 `unknown` 注解的项序号（每次映射唯一，避免不同形参撞同一项）。 */
let unknownAnnotationSeq = 0;

function mapTsType(
  text: string | undefined,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): Abs | undefined {
  if (!text) return undefined;
  const t = unwrapParens(text.trim());
  if (!t) return undefined;
  // 泛型类型参数（`T` / `T extends string`）：绑定由调用方（入口签名 /
  // service 入口见证）从声明面的 `<T …>` 表注入（BUG-277）。
  const bound = typeParams?.get(t);
  if (bound) return bound;

  switch (t) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return absOf({ k: "prim", type: t });
    case "any":
      return absOf({ k: "any" });
    case "unknown":
      // BUG-276：用户显式写的 `unknown` 不是「推断失败」。裸 unknown 形状
      // 无 term 是引擎债令牌（check 的 isTrueUnknownAbs）⇒ 带一个声明项，
      // 让诊断面区分「源码声明」与「分析没拿到信息」。每次映射铸唯一项：
      // 两个 `unknown` 形参不是同一个值（否则 `a === b` 会折叠成恒真）。
      return abs(
        { k: "unknown" },
        v(`unknown#annotation#${++unknownAnnotationSeq}`),
        undefined,
        "exact",
      );
    case "never":
      return absOf({ k: "never" });
    case "object":
      // `object` / `{}` 是**开放**对象：任何非 nullish 值都可赋给它，
      // 成员面未知 ⇒ open（见对象字面量分支注释）。
      return absOf({ k: "obj", slots: {}, open: true });
    case "null":
      return allowNullish ? nullishAbs(null) : undefined;
    case "undefined":
    case "void":
      return allowNullish ? nullishAbs(undefined) : undefined;
    default:
      break;
  }

  // 字面量类型（`"a"` / `1` / `true` / `0xff` / `10n` / `1_000`）：
  // 带 lit term ⇒ 入口域 / zod / guard 保留值域（BUG-261 / BUG-353）。
  const literal = literalAbsOf(t);
  if (literal) return literal;

  // 模板字面量类型（`` `${string}-${number}` ``）：无模式精化时按 string。
  if (t.startsWith("`") && t.endsWith("`")) {
    return absOf({ k: "prim", type: "string" });
  }

  // 函数类型（`(x: number) => string`）：先于联合切分，避免返回位的
  // `A | B` 被当成顶层联合（BUG-248）。
  const fn = functionTypeAbs(t, allowNullish, typeParams);
  if (fn !== null) return fn ?? undefined;

  // `keyof T`：对象键字面量联合；索引签名 / 数组退 string | number（BUG-281）。
  const keyofMapped = keyofAbs(t, allowNullish, typeParams);
  if (keyofMapped !== null) return keyofMapped ?? undefined;

  // 索引访问 `T["k"]` / `T[0]`（BUG-287）。
  const indexedMapped = indexedAccessAbs(t, allowNullish, typeParams);
  if (indexedMapped !== null) return indexedMapped ?? undefined;

  // 联合（`A | B`）：任一支不可映射 ⇒ 整条不映射。
  // nullish 成员不再让整条落空（`string | null` ⇒ `string | null 字面量`），
  // 否则用户写明的可空性会把**其余成员**一起丢掉（整条退 any）。
  const union = splitTopLevel(t, "|");
  if (union.length > 1) {
    const members = union.map((part) => mapTsType(part, allowNullish, typeParams));
    if (members.some((m) => m === undefined)) return undefined;
    return abs({ k: "sum", members: members as Abs[] }, undefined, undefined, "exact");
  }
  // 交叉类型：对象 × 对象合并槽位（`{a} & {b}` ⇒ `{a,b}`）；其余形态
  // （条件 / 推断 / 非对象交叉）仍不映射（BUG-278）。
  const intersection = splitTopLevel(t, "&");
  if (intersection.length > 1) {
    const members = intersection.map((part) => mapTsType(part, allowNullish, typeParams));
    if (members.some((m) => m === undefined)) return undefined;
    const shapes = members.map((m) => m!.shape);
    if (shapes.every((s) => s.k === "obj")) {
      const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
      let index: Extract<Shape, { k: "obj" }>["index"];
      for (const s of shapes as Array<Extract<Shape, { k: "obj" }>>) {
        Object.assign(slots, s.slots);
        if (s.index) index = s.index;
      }
      return absOf({ k: "obj", slots, ...(index ? { index } : {}), open: true });
    }
    if (shapes.length === 2 && shapes[0]!.k === "any") return members[1];
    if (shapes.length === 2 && shapes[1]!.k === "any") return members[0];
    return undefined;
  }
  if (t.includes("extends") || t.includes("infer")) {
    return undefined;
  }

  // `readonly T[]` / `readonly [A, B]` / `T[]`
  const ro = /^readonly\s+(?:\[|(?:Readonly)?Array<|.+\[\])/.test(t);
  const bare = ro ? t.replace(/^readonly\s+/, "") : t;
  const arrMatch = /^(.+)\[\]$/.exec(bare);
  if (arrMatch) {
    const el = mapTsType(arrMatch[1], allowNullish, typeParams);
    return el ? abs({ k: "arr", element: el }, undefined, undefined, "exact") : undefined;
  }
  // `Array<T>` / `ReadonlyArray<T>`
  const genericArr = /^(?:Readonly)?Array<(.+)>$/.exec(bare);
  if (genericArr) {
    const el = mapTsType(genericArr[1], allowNullish, typeParams);
    return el ? abs({ k: "arr", element: el }, undefined, undefined, "exact") : undefined;
  }

  // 元组 `[A, B]` / rest 元组 `[A, ...B[]]`。
  //
  // - **rest 位**（无可选位）⇒ 固定前缀 + `rest` 元素域：Shape 模型本来就能
  //   表达 rest 元组，塌成 `arr(前缀 ∪ rest)` 会把**位置**维度一起抹掉
  //   （`[number, ...string[]]` 的 `t[0]` 恒 number，不是 `number | string`），
  //   并让 dts 返回位同步变宽。前缀为空（`[...string[]]`）时与 arr 同域 ⇒ 折 arr。
  // - **可选位**（`[string, number?]`）⇒ 长度可变且位置不确定，仍降级为
  //   arr(元素域并集)：rest 位先剥 `...`，其自身是数组 / 元组时取元素域
  //   （`...number[]` 的元素是 number，不是 number[]）。
  if (bare.startsWith("[") && bare.endsWith("]")) {
    const inner = bare.slice(1, -1).trim();
    const parts =
      inner === ""
        ? []
        : splitTopLevel(inner, ",").map((p) => tuplePartOf(p));
    const hasOptional = parts.some((p) => p.optional);
    const restIdx = parts.findIndex((p) => p.rest);
    if (restIdx >= 0 && !hasOptional) {
      const prefix: Abs[] = [];
      for (const part of parts.slice(0, restIdx)) {
        const el = mapTsType(part.text, allowNullish, typeParams);
        if (!el) return undefined;
        prefix.push(el);
      }
      const tails: Abs[] = [];
      for (const part of parts.slice(restIdx)) {
        const mapped = mapTsType(part.text, allowNullish, typeParams);
        if (!mapped) return undefined;
        const s = mapped.shape;
        if (s.k === "arr") tails.push(s.element);
        else if (s.k === "tuple") {
          tails.push(...s.elements);
          if (s.rest) tails.push(s.rest);
        } else tails.push(mapped);
      }
      if (tails.length === 0) return undefined; // `[...]` 不是合法 TS
      const rest = joinAbsList(tails);
      if (prefix.length === 0) {
        return abs({ k: "arr", element: rest }, undefined, undefined, "exact");
      }
      return abs({ k: "tuple", elements: prefix, rest }, undefined, undefined, "exact");
    }
    if (hasOptional) {
      const elems: Abs[] = [];
      for (const part of parts) {
        const mapped = mapTsType(part.text, allowNullish, typeParams);
        if (!mapped) return undefined;
        const s = mapped.shape;
        if (part.rest && s.k === "arr") elems.push(s.element);
        else if (part.rest && s.k === "tuple") {
          elems.push(...s.elements);
          if (s.rest) elems.push(s.rest);
        } else elems.push(mapped);
      }
      if (elems.length === 0) return undefined; // `[...]` 不是合法 TS
      return abs({ k: "arr", element: joinAbsList(elems) }, undefined, undefined, "exact");
    }
    const els = parts.map((part) => mapTsType(part.text, allowNullish, typeParams));
    if (els.some((e) => e === undefined)) return undefined;
    return abs({ k: "tuple", elements: els as Abs[] }, undefined, undefined, "exact");
  }

  // 对象类型 `{ a: number; b?: string }`。
  // **开放对象**（`open: true`）：TS 结构类型不封闭值域——带额外属性的
  // 更宽对象可赋给该类型，可选成员也允许缺键 ⇒ 否则 `"b" in x` 与 `{...x}`
  // 的未知键面会给出错精确（合法输入反例）。嵌套对象由递归得到同一口径。
  // 键家族（Object.keys/values/entries）需要入口 Abs 上的「键集不完备」标记
  // （generalize.ts 的 annotationAbsOf 对开放对象 Abs 调 markKeySetOpenAbs）。
  // 不可解析成员（索引签名 / 方法签名…）本就不进槽，open 已覆盖其未知面。
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1).trim();
    const members = inner === "" ? [] : splitTopLevel(inner.replace(/;/g, ","), ",");
    const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
    let index: Extract<Shape, { k: "obj" }>["index"];
    for (const member of members) {
      const m = member.trim();
      if (m === "") continue;
      const idx = splitTopLevel(m, ":");
      if (idx.length !== 2) continue;
      const left = idx[0]!.trim();
      // 索引签名 `{ [k: string]: number }`（BUG-253）：进 shape.index，
      // 成员读按声明值域，而不是空槽表 + unknown。
      if (left.startsWith("[")) {
        const sig = indexSignatureOf(left, idx[1]!, allowNullish, typeParams);
        if (sig) index = sig;
        continue;
      }
      // 方法签名 `{ m(x: number): string }`（BUG-288）：槽值 = fn。
      if (left.endsWith(")")) {
        const method = methodMemberAbs(left, idx[1]!.trim(), allowNullish, typeParams);
        if (method) {
          slots[objectKeyOf(left.slice(0, left.indexOf("(")))!.key] = {
            value: method.abs,
            ...(method.optional ? { optional: true } : {}),
          };
        }
        continue;
      }
      const key = objectKeyOf(left);
      if (!key) continue;
      const value = mapTsType(idx[1], allowNullish, typeParams);
      if (!value) continue;
      slots[key.key] = { value, ...(key.optional ? { optional: true } : {}) };
    }
    return absOf({ k: "obj", slots, ...(index ? { index } : {}), open: true });
  }

  // 其余（类型名 / 别名 / 泛型实例化 / 函数类型 …）不映射
  return undefined;
}

/**
 * 声明类型文本 → Abs 形状（不可映射 ⇒ undefined）。
 *
 * Shape 面**不含值精度**：nullish 在这里仍不映射（调用方拿不到 term 会把
 * 「确定的 null」误读成「推断失败」）。需要 nullish 的入口域走
 * {@link absTypeForTsTypeText}。
 */
export function absShapeForTsTypeText(
  text: string | undefined,
  typeParams?: ReadonlyMap<string, Abs>,
): Shape | undefined {
  return mapTsType(text, false, typeParams)?.shape;
}

/**
 * 声明类型文本 → Abs（不可映射 ⇒ undefined）。
 *
 * 与 {@link absShapeForTsTypeText} 同一条映射链，额外承载 `null` /
 * `undefined` / `void` 的字面量精度 ⇒ 入口形参 / 构造实参 / `this` 接收者
 * 的定义域不再因为一个可空成员退成 any。调用方负责叠加声明域策略
 * （pred / term / 开放对象键集标记）。
 */
export function absTypeForTsTypeText(
  text: string | undefined,
  typeParams?: ReadonlyMap<string, Abs>,
): Abs | undefined {
  return mapTsType(text, true, typeParams);
}

/**
 * Abs → **可内联进转译产物**的 JS 源码（entry-only helper，BUG-265 / BUG-354）。
 *
 * 断言（`x as T`）与局部声明注解（`let x: T = …`）需要在发射期把声明域作为
 * **值**注入生成代码。Abs 是纯数据（shape / term / pred / conf）——除函数
 * 载体（impl 侧表）外都可序列化。本函数按值遍历：
 * - 字符串 / 布尔 / null / number / bigint 正常渲染（bigint 带 `n`）；
 * - 数组与**普通对象**递归（`undefined` 值字段按可选语义省略）；
 * - 函数 / symbol / Map / Set / 循环引用 / 超深结构 ⇒ undefined（调用方
 *   fail-closed：保持旧的解包行为，不伪造类型）。
 *
 * 返回的源码里数字键顺序与对象字面量一致；同一 Abs 恒同一文本（确定性
 * 产物 / 差分基线依赖它）。
 */
export function entryAbsLiteralSourceOf(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const MAX_DEPTH = 64;
  const active = new Set<object>();
  const ser = (value: unknown, depth: number): string | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    if (value === null) return "null";
    switch (typeof value) {
      case "string":
        return JSON.stringify(value);
      case "boolean":
        return value ? "true" : "false";
      case "number":
        if (Number.isNaN(value)) return "NaN";
        if (value === Infinity) return "Infinity";
        if (value === -Infinity) return "-Infinity";
        return String(value);
      case "bigint":
        return `${value}n`;
      case "function":
      case "symbol":
      case "undefined":
        return undefined;
      default:
        break;
    }
    const obj = value as Record<string, unknown>;
    if (active.has(obj)) return undefined;
    if (Array.isArray(obj)) {
      active.add(obj);
      const parts: string[] = [];
      for (const el of obj) {
        const s = ser(el, depth + 1);
        if (s === undefined) {
          active.delete(obj);
          return undefined;
        }
        parts.push(s);
      }
      active.delete(obj);
      return `[${parts.join(", ")}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) return undefined;
    active.add(obj);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const s = ser(v, depth + 1);
      if (s === undefined) {
        active.delete(obj);
        return undefined;
      }
      parts.push(`${JSON.stringify(k)}: ${s}`);
    }
    active.delete(obj);
    return `{ ${parts.join(", ")} }`;
  };
  return ser(a, 0);
}
