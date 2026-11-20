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
import type { Term } from "../term.ts";

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
 * 声明类型文本 → Abs（不可映射 ⇒ undefined）。
 *
 * `allowNullish` 决定 `null` / `undefined` / `void` 怎么处理：
 * - `true`（Abs 面）：映成 nullish 字面量 Abs（见 {@link nullishAbs}）；
 * - `false`（Shape 面）：返回 undefined，保住 Shape 消费者的旧口径
 *   （它们拿不到 term，会把 nullish 误读成「推断失败」）。
 */
function mapTsType(text: string | undefined, allowNullish: boolean): Abs | undefined {
  if (!text) return undefined;
  const t = unwrapParens(text.trim());
  if (!t) return undefined;

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
      return absOf({ k: "unknown" });
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

  // 字面量类型（`"a"` / `1` / `true`）：term 精度带不进本函数，退回基类型
  if (/^(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)$/.test(t)) {
    if (/^["']/.test(t)) return absOf({ k: "prim", type: "string" });
    if (t === "true" || t === "false") return absOf({ k: "prim", type: "boolean" });
    return absOf({ k: "prim", type: "number" });
  }

  // 联合（`A | B`）：任一支不可映射 ⇒ 整条不映射。
  // nullish 成员不再让整条落空（`string | null` ⇒ `string | null 字面量`），
  // 否则用户写明的可空性会把**其余成员**一起丢掉（整条退 any）。
  const union = splitTopLevel(t, "|");
  if (union.length > 1) {
    const members = union.map((part) => mapTsType(part, allowNullish));
    if (members.some((m) => m === undefined)) return undefined;
    return abs({ k: "sum", members: members as Abs[] }, undefined, undefined, "exact");
  }
  // 交叉 / 条件 / 推断等不映射
  if (splitTopLevel(t, "&").length > 1 || t.includes("extends") || t.includes("infer")) {
    return undefined;
  }

  // `readonly T[]` / `T[]`
  const arrMatch = /^(?:readonly\s+)?(.+)\[\]$/.exec(t);
  if (arrMatch) {
    const el = mapTsType(arrMatch[1], allowNullish);
    return el ? abs({ k: "arr", element: el }, undefined, undefined, "exact") : undefined;
  }
  // `Array<T>` / `ReadonlyArray<T>`
  const genericArr = /^(?:Readonly)?Array<(.+)>$/.exec(t);
  if (genericArr) {
    const el = mapTsType(genericArr[1], allowNullish);
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
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    const parts = inner === "" ? [] : splitTopLevel(inner, ",").map((p) => p.trim());
    const hasOptional = parts.some((p) => p.endsWith("?"));
    const restIdx = parts.findIndex((p) => p.startsWith("..."));
    if (restIdx >= 0 && !hasOptional) {
      const prefix: Abs[] = [];
      for (const part of parts.slice(0, restIdx)) {
        const el = mapTsType(part, allowNullish);
        if (!el) return undefined;
        prefix.push(el);
      }
      const tails: Abs[] = [];
      for (const part of parts.slice(restIdx)) {
        const mapped = mapTsType(part.slice(3).trim(), allowNullish);
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
        const rest = part.startsWith("...");
        // 空白变体：`... number[]` / `number ?`
        const partText = (rest ? part.slice(3) : part)
          .trim()
          .replace(/\?\s*$/, "")
          .trim();
        const mapped = mapTsType(partText, allowNullish);
        if (!mapped) return undefined;
        const s = mapped.shape;
        if (rest && s.k === "arr") elems.push(s.element);
        else if (rest && s.k === "tuple") {
          elems.push(...s.elements);
          if (s.rest) elems.push(s.rest);
        } else elems.push(mapped);
      }
      if (elems.length === 0) return undefined; // `[...]` 不是合法 TS
      return abs({ k: "arr", element: joinAbsList(elems) }, undefined, undefined, "exact");
    }
    const els = parts.map((part) => mapTsType(part, allowNullish));
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
    for (const member of members) {
      const m = member.trim();
      if (m === "") continue;
      const idx = splitTopLevel(m, ":");
      if (idx.length !== 2) continue;
      const key = objectKeyOf(idx[0]!);
      if (!key) continue;
      const value = mapTsType(idx[1], allowNullish);
      if (!value) continue;
      slots[key.key] = { value, ...(key.optional ? { optional: true } : {}) };
    }
    return absOf({ k: "obj", slots, open: true });
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
export function absShapeForTsTypeText(text: string | undefined): Shape | undefined {
  return mapTsType(text, false)?.shape;
}

/**
 * 声明类型文本 → Abs（不可映射 ⇒ undefined）。
 *
 * 与 {@link absShapeForTsTypeText} 同一条映射链，额外承载 `null` /
 * `undefined` / `void` 的字面量精度 ⇒ 入口形参 / 构造实参 / `this` 接收者
 * 的定义域不再因为一个可空成员退成 any。调用方负责叠加声明域策略
 * （pred / term / 开放对象键集标记）。
 */
export function absTypeForTsTypeText(text: string | undefined): Abs | undefined {
  return mapTsType(text, true);
}
