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
import { abs, withProvenance, type Abs, type Shape } from "../abs.ts";
import { absFunction, relationFn } from "../abs-fn.ts";
import { abstractSeqIteratorAbs } from "../builtins/error/iterator.ts";
import { noBody } from "../builtins/shared.ts";
import { $call } from "../exec/call.ts";
import { parseSource } from "../parse-source.ts";
import { lit, type Term } from "../term.ts";

/**
 * 注解解析上下文（**单一解析层**的输入）。
 *
 * 文本语法仍由本文件的 `mapTsType` 解析；名字解析（类型参数 / 同文件声明 /
 * 导入声明 / 内建类型 / `typeof` 值引用）全部走这张表。调用方只需构造一次
 * 环境，所有嵌套位共享同一份事实，避免「顶层能解析、对象槽里的同名引用
 * 又回落 any」。
 */
export type AnnotationEnv = {
  typeParams?: ReadonlyMap<string, Abs>;
  namedTypes?: ReadonlyMap<string, string>;
  /** 同文件具名类型声明的**结构节点**（interface / type alias；无类型参数）。 */
  namedTypeNodes?: ReadonlyMap<string, TsTypeNode>;
  valueTypes?: ReadonlyMap<string, string>;
  /** inline `import("spec").T` 的声明文本，键 = `spec#T`（迁移期外置表）。 */
  importTypes?: ReadonlyMap<string, string>;
  builtins?: ReadonlyMap<string, Abs>;
  /** 内部递归深度（只由本模块递增；调用方不传）。 */
  depth?: number;
};

export type AnnotationEnvArg = AnnotationEnv | ReadonlyMap<string, Abs> | undefined;

function normalizeAnnotationEnv(env: AnnotationEnvArg): AnnotationEnv | undefined {
  if (!env) return undefined;
  return (env instanceof Map ? { typeParams: env } : env) as AnnotationEnv | undefined;
}

let activeAnnotationEnv: AnnotationEnv | undefined;

function withAnnotationEnv<T>(env: AnnotationEnvArg, fn: () => T): T {
  if (env === undefined) return fn();
  const prev = activeAnnotationEnv;
  activeAnnotationEnv = { ...prev, ...normalizeAnnotationEnv(env) };
  try {
    return fn();
  } finally {
    activeAnnotationEnv = prev;
  }
}

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

/** 泛型实参切分（顶层逗号；`Map<string, number>` ⇒ 两项）。 */
export function splitTypeArgs(text: string): string[] {
  return splitTopLevel(text, ",").map((p) => p.trim());
}

/** 内建类型名的实例面（无泛型实参 / 非泛型内建）。 */
function builtinTypeAbs(name: string): Abs | undefined {
  const any = absOf({ k: "any" });
  const str = absOf({ k: "prim", type: "string" });
  const num = absOf({ k: "prim", type: "number" });
  const bool = absOf({ k: "prim", type: "boolean" });
  const undef = nullishAbs(undefined);
  const fn0 = (ret: Abs): Abs => relationFn([], ret, { params: [] });
  const fn1 = (arg: Abs, ret: Abs): Abs => relationFn([arg], ret, { params: ["value"] });
  switch (name) {
    case "Date":
      return absOf({
        k: "obj",
        open: true,
        slots: {
          getTime: { value: fn0(num) },
          valueOf: { value: fn0(num) },
          toISOString: { value: fn0(str) },
          toJSON: { value: fn0(str) },
          getFullYear: { value: fn0(num) },
          getMonth: { value: fn0(num) },
          getDate: { value: fn0(num) },
          getDay: { value: fn0(num) },
          getHours: { value: fn0(num) },
          getMinutes: { value: fn0(num) },
          getSeconds: { value: fn0(num) },
          getMilliseconds: { value: fn0(num) },
        },
      });
    case "RegExp":
      return absOf({
        k: "obj",
        open: true,
        slots: {
          source: { value: str },
          flags: { value: str },
          global: { value: bool },
          ignoreCase: { value: bool },
          multiline: { value: bool },
          test: { value: fn1(str, bool) },
          exec: { value: fn1(str, joinAbsList([any, nullishAbs(null)])) },
        },
      });
    case "Error":
      return absOf({
        k: "obj",
        open: true,
        slots: {
          name: { value: str },
          message: { value: str },
          stack: { value: joinAbsList([str, undef]), optional: true },
        },
      });
    case "Promise":
      return abs({ k: "eff", eff: "promise", inner: any }, undefined, undefined, "exact");
    case "Map":
      return absOf({ k: "obj", slots: {}, open: true, index: { key: any, value: any } });
    case "Set":
      return absOf({ k: "obj", slots: {}, open: true });
    case "WeakMap":
    case "WeakSet":
      return absOf({ k: "obj", slots: {}, open: true });
    case "Function":
      return relationFn([], any, { params: [] });
    case "Array":
    case "ReadonlyArray":
      return absOf({ k: "arr", element: any });
    case "Object":
      return absOf({ k: "obj", slots: {}, open: true });
    default:
      return undefined;
  }
}

/** 泛型内建类型：`Map<K,V>` / `Set<T>` / `Promise<T>` / `Record<K,V>`。 */
function builtinGenericAbs(text: string, allowNullish: boolean): Abs | undefined {
  const m = /^([A-Za-z_$][\w$]*)\s*<([\s\S]+)>$/.exec(text.trim());
  if (!m) return undefined;
  const name = m[1]!;
  const args = splitTypeArgs(m[2]!);
  const mapped = args.map((a) => mapTsType(a, allowNullish));
  if (mapped.some((a) => a === undefined)) return undefined;
  const [a0, a1] = mapped as Abs[];
  const any = absOf({ k: "any" });
  const str = absOf({ k: "prim", type: "string" });
  const num = absOf({ k: "prim", type: "number" });
  const bool = absOf({ k: "prim", type: "boolean" });
  const undef = nullishAbs(undefined);
  const method = (params: Abs[], ret: Abs, names: string[]): Abs =>
    relationFn(params, ret, { params: names });
  /** 字符串字面量键集合（Pick/Omit 的 K 位）；不可静态判 ⇒ undefined。 */
  const stringKeysOf = (a: Abs | undefined): Set<string> | undefined => {
    if (!a) return undefined;
    const out = new Set<string>();
    const add = (m: Abs): boolean => {
      if (m.shape.k === "sum") return m.shape.members.every(add);
      if (m.shape.k === "prim" && m.term?.op === "lit" && typeof m.term.value === "string") {
        out.add(m.term.value);
        return true;
      }
      return false;
    };
    return add(a) ? out : undefined;
  };
  /** 对象槽变换；非对象 / 空槽表按「不可映射」处理，不伪造。 */
  const mapObjSlots = (
    a: Abs | undefined,
    fn: (slot: { value: Abs; optional?: boolean; readonly?: boolean }) => {
      value: Abs;
      optional?: boolean;
      readonly?: boolean;
    } | undefined,
  ): Abs | undefined => {
    if (!a || a.shape.k !== "obj") return undefined;
    const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
    for (const [k, slot] of Object.entries(a.shape.slots)) {
      const mapped = fn(slot);
      if (mapped) slots[k] = mapped;
    }
    return abs(
      { ...a.shape, slots },
      a.term,
      a.pred,
      a.conf,
    );
  };
  // BUG-401：注解 Map/Set 也要有原生迭代协议面。返回抽象序列迭代器
  // （元素域随 Abs 携带、长度不可知）⇒ `[...m.keys()]` 既不记假 may-throw，
  // dts 也能从 `genElements` 投影出真实元素域。
  const iterMethod = (el: Abs): Abs =>
    absFunction(
      [],
      {
        body: noBody,
        // 每次调用产出新迭代器对象；元素侧表（WeakMap 身份键控）不能
        // 经过 relation 的 α 替换复制，否则 `$elems` 读不到元素域。
        apply: (): Abs => abstractSeqIteratorAbs(el),
      },
      { ctor: false, paramTypes: [], returnType: abstractSeqIteratorAbs(el) },
    );
  const forEachMethod = (cbArgs: Abs[], names: string[]): Abs => {
    const cbType = relationFn(cbArgs, undef, { params: names });
    return absFunction(
      ["cb"],
      {
        body: noBody,
        apply: (args): Abs => {
          // 注解集合的条目域是单代表；调用一次即可让回调的副作用进入
          // 返回位（原生多次调用的结果按抽象域 join）。
          const cb = args[0];
          if (cb) $call(cb, cbArgs, args[1]);
          return undef;
        },
      },
      { ctor: false, paramTypes: [cbType], returnType: undef, length: 1 },
    );
  };
  switch (name) {
    case "Map":
    case "ReadonlyMap": {
      const k = a0 ?? any;
      const v = a1 ?? any;
      const entry = abs({ k: "tuple", elements: [k, v] }, undefined, undefined, "exact");
      const self = absOf({ k: "obj", slots: {}, open: true, index: { key: k, value: v } });
      const out = absOf({
        k: "obj",
        open: true,
        index: { key: k, value: v },
        slots: {
          get: { value: method([k], joinAbsList([v, undef]), ["key"]) },
          set: { value: method([k, v], self, ["key", "value"]) },
          has: { value: method([k], bool, ["key"]) },
          delete: { value: method([k], bool, ["key"]) },
          clear: { value: method([], self, []) },
          size: { value: num, readonly: true },
          keys: { value: iterMethod(k) },
          values: { value: iterMethod(v) },
          entries: { value: iterMethod(entry) },
          forEach: { value: forEachMethod([v, k, self], ["value", "key", "map"]) },
          "@@iterator": { value: iterMethod(entry), symbolKey: true },
        },
      });
      // BUG-401：`$elems` / dts 的集合身份面。obj 形状保留方法建模，
      // facets.brand 让 spread 的元素域走条目表，而不是用户迭代器协议的
      // 「done 不可判 ⇒ unknown」兜底。
      out.facets = { ...(out.facets ?? {}), brand: "Map", genElements: [entry] };
      return out;
    }
    case "WeakMap": {
      const k = a0 ?? absOf({ k: "obj", slots: {}, open: true });
      const v = a1 ?? any;
      return absOf({
        k: "obj",
        open: true,
        slots: {
          get: { value: method([k], joinAbsList([v, undef]), ["key"]) },
          set: { value: method([k, v], absOf({ k: "obj", slots: {}, open: true }), ["key", "value"]) },
          has: { value: method([k], bool, ["key"]) },
          delete: { value: method([k], bool, ["key"]) },
        },
      });
    }
    case "Set":
    case "ReadonlySet": {
      const v = a0 ?? any;
      const entry = abs({ k: "tuple", elements: [v, v] }, undefined, undefined, "exact");
      const self = absOf({ k: "obj", slots: {}, open: true });
      const out = absOf({
        k: "obj",
        open: true,
        slots: {
          add: { value: method([v], self, ["value"]) },
          has: { value: method([v], bool, ["value"]) },
          delete: { value: method([v], bool, ["value"]) },
          clear: { value: method([], self, []) },
          size: { value: num, readonly: true },
          keys: { value: iterMethod(v) },
          values: { value: iterMethod(v) },
          entries: { value: iterMethod(entry) },
          forEach: { value: forEachMethod([v, v, self], ["value", "key", "set"]) },
          "@@iterator": { value: iterMethod(v), symbolKey: true },
        },
      });
      out.facets = { ...(out.facets ?? {}), brand: "Set", genElements: [v] };
      return out;
    }
    case "WeakSet": {
      const v = a0 ?? absOf({ k: "obj", slots: {}, open: true });
      return absOf({
        k: "obj",
        open: true,
        slots: {
          add: { value: method([v], absOf({ k: "obj", slots: {}, open: true }), ["value"]) },
          has: { value: method([v], bool, ["value"]) },
          delete: { value: method([v], bool, ["value"]) },
        },
      });
    }
    case "Promise":
      return abs({ k: "eff", eff: "promise", inner: a0 ?? any }, undefined, undefined, "exact");
    // BUG-410：TS utility type 的 Abs 侧语义。只做结构可表达的三类：
    // 全槽可选/必填、只读、按键投影。无法静态判键 / 非对象 ⇒ undefined
    // （调用方回落 any，与既有「不猜」口径一致）。
    case "Partial":
      return mapObjSlots(a0, (slot) => ({ ...slot, optional: true }));
    case "Required":
      return mapObjSlots(a0, (slot) => {
        const { optional: _optional, ...rest } = slot;
        return rest;
      });
    case "Readonly":
      return mapObjSlots(a0, (slot) => ({ ...slot, readonly: true }));
    case "Pick":
    case "Omit": {
      const keys = stringKeysOf(a1);
      if (!keys || !a0 || a0.shape.k !== "obj") return undefined;
      const keep = name === "Pick";
      const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
      for (const [k, slot] of Object.entries(a0.shape.slots)) {
        if (keys.has(k) === keep) slots[k] = slot;
      }
      return abs({ ...a0.shape, slots }, a0.term, a0.pred, a0.conf);
    }
    case "Record": {
      const k = a0 ?? str;
      const v = a1 ?? any;
      return absOf({ k: "obj", slots: {}, open: true, index: { key: k, value: v } });
    }
    default:
      return undefined;
  }
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

type AstNode = Record<string, unknown> & { start?: number; end?: number; type?: string };

function nodeTextOf(source: string, node: AstNode | undefined): string | undefined {
  if (typeof node?.start !== "number" || typeof node.end !== "number") return undefined;
  return source.slice(node.start, node.end);
}

function classMemberKeyText(key: AstNode | undefined): string | undefined {
  if (!key) return undefined;
  if (key.type === "Identifier") return typeof key.name === "string" ? key.name : undefined;
  if (key.type === "StringLiteral") return JSON.stringify(key.value);
  if (key.type === "NumericLiteral") return String(key.value);
  return undefined;
}

function classMethodParamText(source: string, raw: AstNode): string | undefined {
  const p = raw.type === "TSParameterProperty" ? (raw.parameter as AstNode | undefined) : raw;
  if (!p || p.type === "Identifier" && p.name === "this") return undefined;
  let text = nodeTextOf(source, p);
  if (!text) return undefined;
  // 默认值不属于类型签名：`x: number = 1` ⇒ `x?: number`。
  const eq = text.indexOf("=");
  if (eq >= 0) {
    text = text.slice(0, eq).trim();
    if (!text.endsWith("?")) {
      const colon = text.indexOf(":");
      text = colon >= 0 ? `${text.slice(0, colon)}?${text.slice(colon)}` : `${text}?`;
    }
  }
  return text;
}

/**
 * BUG-403：类声明的**实例类型**（同文件具名类型表）。
 *
 * 只收实例成员（static 不入）；方法按对象字面量方法签名 `m(x: T): R`
 * 发布——对象文本映射器已支持该形态（BUG-288）。继承成员暂不展开；
 * 需要基类时调用方的导入表 / 类型文本解析会另行补面。
 */
function classInstanceTypeText(source: string, stmt: AstNode): string | undefined {
  const body = stmt.body as { body?: AstNode[] } | undefined;
  if (!Array.isArray(body?.body)) return undefined;
  const members: string[] = [];
  for (const m of body.body) {
    if (m.static === true) continue;
    const key = classMemberKeyText(m.key as AstNode | undefined);
    if (!key) continue;
    const optional = m.optional === true ? "?" : "";
    const ann = nodeTextOf(source, m.typeAnnotation as AstNode | undefined)?.replace(/^\s*:\s*/, "");
    if (m.type === "ClassProperty" || m.type === "ClassAccessorProperty") {
      members.push(`${key}${optional}: ${ann ?? "any"}`);
      continue;
    }
    if (m.type === "ClassMethod" || m.type === "TSDeclareMethod") {
      const kind = m.kind;
      if (kind === "constructor") {
        for (const p of (m.params as AstNode[] | undefined) ?? []) {
          if (p.type !== "TSParameterProperty") continue;
          const inner = p.parameter as AstNode | undefined;
          const name = inner && inner.type === "Identifier" ? String(inner.name) : undefined;
          if (!name) continue;
          const pAnn = nodeTextOf(source, inner?.typeAnnotation as AstNode | undefined)?.replace(/^\s*:\s*/, "");
          members.push(`${name}: ${pAnn ?? "any"}`);
        }
        continue;
      }
      if (kind === "get") {
        members.push(`${key}${optional}: ${ann ?? "any"}`);
        continue;
      }
      if (kind === "set") continue;
      const ret = nodeTextOf(source, m.returnType as AstNode | undefined)?.replace(/^\s*:\s*/, "");
      const params = ((m.params as AstNode[] | undefined) ?? [])
        .map((p) => classMethodParamText(source, p))
        .filter((p): p is string => p !== undefined)
        .join(", ");
      members.push(`${key}${optional}(${params}): ${ret ?? "any"}`);
    }
  }
  return `{${members.join(";")}}`;
}

function enumLiteralValue(init: AstNode): string | undefined {
  if (init.type === "NumericLiteral") return String(init.value);
  if (init.type === "StringLiteral") return JSON.stringify(init.value);
  if (
    init.type === "UnaryExpression" &&
    (init.operator === "-" || init.operator === "+") &&
    (init.argument as AstNode | undefined)?.type === "NumericLiteral"
  ) {
    const n = Number((init.argument as AstNode).value);
    return String(init.operator === "-" ? -n : n);
  }
  return undefined;
}

/**
 * BUG-403：enum 作为**类型**时的值域（成员字面量联合）。
 * 无显式初值按 TS 自增规则推进；不可静态求值的初值跳过（不猜）。
 */
function enumTypeText(stmt: AstNode): string | undefined {
  // Babel 8：`TSEnumDeclaration.body` 是 `TSEnumBody`（members 在其上）；
  // 旧版直接把 members 挂在声明上。两种形态都收。
  const body = stmt.body as { members?: AstNode[] } | undefined;
  const members = (stmt.members as AstNode[] | undefined) ?? body?.members;
  if (!Array.isArray(members)) return undefined;
  const values: string[] = [];
  let next = 0;
  for (const m of members) {
    const init = m.initializer as AstNode | undefined;
    if (!init) {
      values.push(String(next));
      next += 1;
      continue;
    }
    const v = enumLiteralValue(init);
    if (v === undefined) continue;
    values.push(v);
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== "") next = n + 1;
  }
  if (values.length === 0) return "number";
  return values.join(" | ");
}

const namedTypeNodeMemo = new Map<string, ReadonlyMap<string, TsTypeNode>>();
const NAMED_TYPE_NODE_MEMO_MAX = 8;

/**
 * 同文件具名类型声明 → **结构节点**（interface / type alias）。
 *
 * 与 `namedTypeTextsForSource` 同源同扫描，但保留节点：node→Abs 单点解析
 * 不再把 interface 摊平成文本（访问器 / 调用签名 / extends 等成员语义由
 * `mapTsTypeNode` 一处消费）。带类型参数的声明仍不展开（替换类型参数不在
 * 本层做）；调用方回落文本表。
 */
export function namedTypeNodesForSource(source: string): ReadonlyMap<string, TsTypeNode> {
  const hit = namedTypeNodeMemo.get(source);
  if (hit) return hit;
  const out = new Map<string, TsTypeNode>();
  try {
    const ast = parseSource(source, { keepTs: true }) as unknown as {
      program: { body: Array<Record<string, unknown>> };
    };
    for (const raw of ast.program.body) {
      const stmt =
        raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
          ? ((raw.declaration as Record<string, unknown> | undefined) ?? raw)
          : raw;
      const id = stmt.id as { name?: string } | undefined;
      if (!id?.name || stmt.typeParameters) continue;
      if (stmt.type === "TSInterfaceDeclaration" || stmt.type === "TSTypeAliasDeclaration") {
        out.set(id.name, stmt as TsTypeNode);
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（调用方回落文本 / any，不猜）
  }
  if (namedTypeNodeMemo.size >= NAMED_TYPE_NODE_MEMO_MAX) {
    const oldest = namedTypeNodeMemo.keys().next().value;
    if (oldest !== undefined) namedTypeNodeMemo.delete(oldest);
  }
  namedTypeNodeMemo.set(source, out);
  return out;
}

export function namedTypeTextsForSource(source: string): ReadonlyMap<string, string> {
  const hit = namedTypeTextMemo.get(source);
  if (hit) return hit;
  const out = new Map<string, string>();
  const interfaces = new Map<string, { members: string[]; bases: string[] }>();
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
        const body = stmt.body as {
          start?: number;
          end?: number;
          body?: Array<{ start?: number; end?: number }>;
        } | undefined;
        if (typeof body?.start !== "number" || typeof body.end !== "number") continue;
        const members = Array.isArray(body.body)
          ? body.body
              .filter((m) => typeof m.start === "number" && typeof m.end === "number")
              .map((m) => source.slice(m.start, m.end))
          : [];
        // 接口继承子句不是 body 的成员：单靠 body 文本会丢掉全部继承成员
        // （报告 408）。这里登记基名，循环后统一摊平（同文件基接口可后声明）。
        const bases: string[] = [];
        for (const h of (stmt.extends as Array<Record<string, unknown>> | undefined) ?? []) {
          const expr = h.expression as { type?: string; name?: string } | undefined;
          if (expr?.type === "Identifier" && typeof expr.name === "string" && !h.typeParameters) {
            bases.push(expr.name);
          }
        }
        interfaces.set(id.name, {
          members:
            members.length > 0 ? members : [source.slice(body.start + 1, body.end - 1)].filter((s) => s.trim() !== ""),
          bases,
        });
        continue;
      } else if (type === "TSTypeAliasDeclaration") {
        const ann = stmt.typeAnnotation as { start?: number; end?: number } | undefined;
        if (typeof ann?.start !== "number" || typeof ann.end !== "number") continue;
        out.set(id.name, source.slice(ann.start, ann.end));
      } else if (type === "ClassDeclaration" || type === "ClassExpression") {
        // BUG-403：class 作为类型 = 实例结构；此前只登记 interface / type
        // alias ⇒ `x: Cat` 直接回落 any（连 x.name 都记假 may-throw）。
        const text = classInstanceTypeText(source, stmt as AstNode);
        if (text) out.set(id.name, text);
      } else if (type === "TSEnumDeclaration") {
        // BUG-403：enum 作为类型 = 成员字面量联合。
        const text = enumTypeText(stmt as AstNode);
        if (text) out.set(id.name, text);
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（调用方按旧路径回落 any，不猜）
  }
  // 接口摊平：先递归基接口（同文件可后声明），再拼自身成员。环 / 未解析
  // 基名按既有「不猜」口径跳过；不得整条丢自身成员。
  const flatten = (name: string, stack: Set<string>): string | undefined => {
    const decl = interfaces.get(name);
    const known = out.get(name);
    if (!decl) return known;
    if (stack.has(name)) return undefined;
    stack.add(name);
    const inherited: string[] = [];
    for (const base of decl.bases) {
      const text = flatten(base, stack);
      if (!text) continue;
      const inner = text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text;
      if (inner.trim() !== "") inherited.push(inner);
    }
    stack.delete(name);
    const own = decl.members.join(";");
    return `{${[...inherited, own].filter((s) => s.trim() !== "").join(";")}}`;
  };
  for (const name of interfaces.keys()) out.set(name, flatten(name, new Set()) ?? "{}");
  if (namedTypeTextMemo.size >= NAMED_TYPE_TEXT_MEMO_MAX) {
    const oldest = namedTypeTextMemo.keys().next().value;
    if (oldest !== undefined) namedTypeTextMemo.delete(oldest);
  }
  namedTypeTextMemo.set(source, out);
  return out;
}

/**
 * 同文件顶层**值**声明 → 类型文本（`typeof X` 入口注解用）。
 *
 * 只收能静态写成类型的初始化器（字面量 / 对象 / 数组 / 函数 / 类不展开）；
 * 引用 / 调用表达式不猜。跨文件值引用由 service 的导入表补齐。
 */
const valueTypeTextMemo = new Map<string, ReadonlyMap<string, string>>();
const VALUE_TYPE_TEXT_MEMO_MAX = 8;

/** 初始化式 → 可静态写出的值类型文本（`typeof cfg.port` 的 dotted 表用）。 */
function staticValueTypeText(node: Record<string, unknown> | undefined): string | undefined {
  if (!node?.type) return undefined;
  switch (node.type) {
    case "StringLiteral":
      return "string";
    case "NumericLiteral":
      return "number";
    case "BooleanLiteral":
      return "boolean";
    case "BigIntLiteral":
      return "bigint";
    case "TemplateLiteral":
      return "string";
    case "NullLiteral":
      return "null";
    case "ObjectExpression": {
      const parts: string[] = [];
      for (const raw of (node.properties as Array<Record<string, unknown>> | undefined) ?? []) {
        if (raw.type !== "ObjectProperty" || raw.computed === true) continue;
        const key = raw.key as Record<string, unknown> | undefined;
        const name =
          key?.type === "Identifier" && typeof key.name === "string"
            ? key.name
            : typeof key?.value === "string" || typeof key?.value === "number"
              ? String(key.value)
              : undefined;
        if (!name) continue;
        const text = staticValueTypeText(raw.value as Record<string, unknown> | undefined);
        if (text) parts.push(`${name}: ${text}`);
      }
      return `{${parts.join(";")}}`;
    }
    case "ArrayExpression": {
      const els = (node.elements as Array<Record<string, unknown> | null | undefined> | undefined) ?? [];
      const types = els.map((e) => staticValueTypeText(e ?? undefined));
      if (types.length > 0 && types.every((t) => t === "number")) return "number[]";
      if (types.length > 0 && types.every((t) => t === "string")) return "string[]";
      if (types.length > 0 && types.every((t) => t === "boolean")) return "boolean[]";
      return undefined;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return staticValueTypeText(node.expression as Record<string, unknown> | undefined);
    default:
      return undefined;
  }
}

/** 对象字面量的 dotted 值类型表：`cfg.port` / `cfg.nested.on`。 */
function collectDottedValueTypes(
  init: Record<string, unknown>,
  prefix: string,
  out: Map<string, string>,
): void {
  if (init.type !== "ObjectExpression") return;
  for (const raw of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
    if (raw.type !== "ObjectProperty" || raw.computed === true) continue;
    const key = raw.key as Record<string, unknown> | undefined;
    const name =
      key?.type === "Identifier" && typeof key.name === "string"
        ? key.name
        : typeof key?.value === "string" || typeof key?.value === "number"
          ? String(key.value)
          : undefined;
    if (!name) continue;
    const value = raw.value as Record<string, unknown> | undefined;
    const text = staticValueTypeText(value);
    if (text) out.set(`${prefix}.${name}`, text);
    if (value?.type === "ObjectExpression") collectDottedValueTypes(value, `${prefix}.${name}`, out);
  }
}

export function valueTypeTextsForSource(source: string): ReadonlyMap<string, string> {
  const hit = valueTypeTextMemo.get(source);
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
      if (stmt.type === "VariableDeclaration") {
        for (const d of (stmt.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
          const id = d.id as { type?: string; name?: string } | undefined;
          const init = d.init as { start?: number; end?: number; type?: string } | undefined;
          if (id?.type !== "Identifier" || typeof id.name !== "string" || !init) continue;
          if (typeof init.start !== "number" || typeof init.end !== "number") continue;
          const ok = new Set([
            "ObjectExpression",
            "ArrayExpression",
            "StringLiteral",
            "NumericLiteral",
            "BooleanLiteral",
            "BigIntLiteral",
            "TemplateLiteral",
            "ArrowFunctionExpression",
            "FunctionExpression",
            "ClassExpression",
          ]);
          if (!init.type || !ok.has(init.type)) continue;
          out.set(id.name, source.slice(init.start, init.end));
          // BUG-500：`typeof cfg.port` 的 dotted path 也要进表；顶层整对象
          // 文本只覆盖 `typeof cfg`，成员路径会 miss ⇒ 入口回落 any。
          if (init.type === "ObjectExpression") {
            collectDottedValueTypes(init as Record<string, unknown>, id.name, out);
          }
        }
      } else if (stmt.type === "FunctionDeclaration") {
        const id = stmt.id as { name?: string } | undefined;
        if (!id?.name || typeof stmt.start !== "number" || typeof stmt.end !== "number") continue;
        // `typeof fn` 的调用面：只投函数类型文本，不展开函数体。
        const params = ((stmt.params as Array<Record<string, unknown>> | undefined) ?? []).map(
          (p, i) => {
            const ann = p.typeAnnotation as { typeAnnotation?: { start?: number; end?: number } } | undefined;
            const t =
              ann?.typeAnnotation &&
              typeof ann.typeAnnotation.start === "number" &&
              typeof ann.typeAnnotation.end === "number"
                ? source.slice(ann.typeAnnotation.start, ann.typeAnnotation.end)
                : "any";
            const name = (p.name as string | undefined) ?? `arg${i}`;
            return `${name}: ${t}`;
          },
        );
        const rt = stmt.returnType as { typeAnnotation?: { start?: number; end?: number } } | undefined;
        const ret =
          rt?.typeAnnotation &&
          typeof rt.typeAnnotation.start === "number" &&
          typeof rt.typeAnnotation.end === "number"
            ? source.slice(rt.typeAnnotation.start, rt.typeAnnotation.end)
            : "any";
        out.set(id.name, `(${params.join(", ")}) => ${ret}`);
      }
    }
  } catch {
    // 解析失败 ⇒ 空表
  }
  if (valueTypeTextMemo.size >= VALUE_TYPE_TEXT_MEMO_MAX) {
    const oldest = valueTypeTextMemo.keys().next().value;
    if (oldest !== undefined) valueTypeTextMemo.delete(oldest);
  }
  valueTypeTextMemo.set(source, out);
  return out;
}

/**
 * 跨文件类型声明：读 import 语句，把被导入模块的顶层 type/interface
 * 声明的**文本**映射到本地名。`load` 由调用方提供（service 用 fs；
 * core 测试可传内存表）。
 *
 * 只展开**具名 type 声明**（interface / type alias）；函数 / 类 / 值导入
 * 不进本表（它们走 `valueTypes` 或 Abs 观测）。命名空间导入不展开。
 */
export function importedTypeTextsForSource(
  source: string,
  load: (specifier: string) => string | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  try {
    const ast = parseSource(source, { keepTs: true }) as unknown as {
      program: { body: Array<Record<string, unknown>> };
    };
    for (const stmt of ast.program.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      const srcNode = stmt.source as { value?: unknown } | undefined;
      if (typeof srcNode?.value !== "string") continue;
      const specs = (stmt.specifiers as Array<Record<string, unknown>> | undefined) ?? [];
      // 只展开**类型导入**（`import type` 或 `import { type X }`）：
      // 运行时包（zod / express …）的 .d.ts 很大，逐个 import 全量解析会拖慢
      // 每个入口；无 type 修饰的运行时导入不可能是本解析层的类型来源。
      const typeImport =
        stmt.importKind === "type" || specs.some((sp) => sp.importKind === "type");
      if (!typeImport) continue;
      const loaded = load(srcNode.value);
      if (loaded === undefined) continue;
      const decls = namedTypeTextsForSource(loaded);
      for (const spec of specs) {
        if (spec.type !== "ImportSpecifier") continue;
        const imported = spec.imported as { name?: string; value?: string } | undefined;
        const local = spec.local as { name?: string } | undefined;
        const importedName =
          typeof imported?.name === "string"
            ? imported.name
            : typeof imported?.value === "string"
              ? imported.value
              : undefined;
        if (!importedName || !local?.name) continue;
        const text = decls.get(importedName);
        if (text !== undefined) out.set(local.name, text);
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（回落 any，不猜）
  }
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
  const isCtor = left.startsWith("new ");
  if (isCtor) left = left.slice(4).trim();
  if (!left.startsWith("(") || !left.endsWith(")")) return undefined;
  const params = fnParamsOf(left.slice(1, -1), allowNullish, typeParams);
  if (!params) return undefined;
  const returnType = mapTsType(right, allowNullish, typeParams);
  if (!returnType) return undefined;
  // 对象槽里的函数值走成员调用面时会读 impl（exec/class/invoke.ts 的
  // invokePropertyValue）⇒ 用 relationFn 同时写 shape 与 relation 实现。
  // `new (x) => T` 的 `new` 是**可构造性**维度，不是装饰：用 absFunction 的
  // ctor facet 承载，否则 `new c(1)` 会被记成不可调用 / 可裸调用（报告 423）。
  if (isCtor) {
    const fnAbs = absFunction(
      params.names,
      { relation: { paramTypes: params.types, returnType } },
      { paramTypes: params.types, returnType, ctor: true, conf: "path" },
    );
    return fnAbs;
  }
  return relationFn(
    params.types,
    returnType,
    { params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)) },
  );
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

/** 对象类型成员的单点模型：文本 / 节点两个生产者共用同一消费者。 */
type ObjectMember =
  | { kind: "property"; key: string; value: Abs; optional?: boolean; readonly?: boolean }
  | { kind: "method"; key: string; value: Abs; optional?: boolean }
  | { kind: "get" | "set"; key: string; value: Abs }
  | { kind: "call"; value: Abs }
  | { kind: "construct"; value: Abs }
  | { kind: "index"; key: Abs; value: Abs };

/** `[Symbol.iterator]` 一类的 well-known symbol 键 → 引擎槽键（`@@iterator`）。 */
function wellKnownSymbolSlotKeyOfText(raw: string): string | undefined {
  const m = /^\[\s*Symbol\.([A-Za-z_$][\w$]*)\s*\]$/.exec(raw.trim());
  return m ? `@@${m[1]}` : undefined;
}

/**
 * 对象类型成员文本 → {@link ObjectMember}。
 *
 * 这里是**唯一**的成员分类点：索引签名 / 调用签名 / 构造签名 / 访问器 /
 * 方法 / 属性 / 计算 symbol 成员都从这一处进入 Abs。此前对象分支按
 * `left.endsWith(")")` 二分会把 `(x): T`、`new (x): T`、`get a()` 全误判成
 * 名为 `(x)` / `new` / `get a` 的方法（报告 409 / 423 / 471 / 480）。
 */
function objectMemberOfText(
  raw: string,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): ObjectMember | undefined {
  const m = raw.trim();
  if (!m) return undefined;

  // 访问器：`get x(): T` / `set x(v: T)`（在冒号拆分前识别，避免把
  // `get x()` 当方法、把 setter 的无返回形态当属性）。
  const accessor = /^(get|set)\s+([\s\S]+)$/.exec(m);
  if (accessor) {
    const kind = accessor[1] as "get" | "set";
    const rest = accessor[2]!.trim();
    const open = rest.indexOf("(");
    if (open <= 0) return undefined;
    const key = objectKeyOf(rest.slice(0, open));
    if (!key) return undefined;
    const close = rest.lastIndexOf(")");
    if (close < open) return undefined;
    if (kind === "get") {
      const retText = rest.slice(close + 1).replace(/^\s*:\s*/, "").trim();
      const value = retText ? mapTsType(retText, allowNullish, typeParams) : undefined;
      return value ? { kind: "get", key: key.key, value } : undefined;
    }
    const params = fnParamsOf(rest.slice(open + 1, close), allowNullish, typeParams);
    if (!params || params.types.length === 0) return undefined;
    return { kind: "set", key: key.key, value: params.types[0]! };
  }

  // 索引签名 / 计算 symbol 成员：`[k: string]: T` / `[Symbol.iterator](): T`
  // （`readonly` 前缀只影响索引签名/计算的只读性，不改变成员分类）
  const indexHead = m.startsWith("readonly ") ? m.slice("readonly ".length).trim() : m;
  if (indexHead.startsWith("[")) {
    const close = indexHead.indexOf("]");
    if (close < 0) return undefined;
    const left = indexHead.slice(0, close + 1);
    const after = indexHead.slice(close + 1).trim();
    if (after.startsWith(":")) {
      const sig = indexSignatureOf(left, after.slice(1).trim(), allowNullish, typeParams);
      return sig ? { kind: "index", key: sig.key, value: sig.value } : undefined;
    }
    if (after.startsWith("(")) {
      const key = wellKnownSymbolSlotKeyOfText(left);
      if (!key) return undefined;
      const closeParen = after.indexOf(")");
      if (closeParen < 0) return undefined;
      const params = fnParamsOf(after.slice(1, closeParen), allowNullish, typeParams);
      if (!params) return undefined;
      const retText = after.slice(closeParen + 1).replace(/^\s*:\s*/, "").trim();
      const returnType = retText ? mapTsType(retText, allowNullish, typeParams) : undefined;
      if (!returnType) return undefined;
      return {
        kind: "method",
        key,
        value: relationFn(params.types, returnType, {
          params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)),
        }),
      };
    }
    return undefined;
  }

  const idx = splitTopLevel(m, ":");
  if (idx.length !== 2) return undefined;
  const head = idx[0]!.trim();
  const tail = idx[1]!.trim();

  // 调用签名 / 构造签名：`(x: T): R` / `new (x: T): R`
  const construct = head.startsWith("new ") ? head.slice(4).trim() : head;
  if (construct.startsWith("(") && construct.endsWith(")")) {
    const params = fnParamsOf(construct.slice(1, -1), allowNullish, typeParams);
    if (!params) return undefined;
    const returnType = mapTsType(tail, allowNullish, typeParams);
    if (!returnType) return undefined;
    const value = relationFn(params.types, returnType, {
      params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)),
    });
    return { kind: head.startsWith("new ") ? "construct" : "call", value };
  }

  // 方法：`m(x): R` / `m?<T>(x): R`（键清洗掉类型参数）
  const open = head.indexOf("(");
  if (open > 0 && head.endsWith(")")) {
    const key = objectKeyOf(head.slice(0, open).replace(/<[\s\S]*$/, "").trim());
    if (!key) return undefined;
    const params = fnParamsOf(head.slice(open + 1, -1), allowNullish, typeParams);
    if (!params) return undefined;
    const returnType = mapTsType(tail, allowNullish, typeParams);
    if (!returnType) return undefined;
    return {
      kind: "method",
      key: key.key,
      value: relationFn(params.types, returnType, {
        params: params.names.map((n, i) => (params.optional[i] ? `${n}?` : n)),
      }),
      ...(key.optional ? { optional: true } : {}),
    };
  }

  // 属性：`p?: T` / `readonly p: T`
  const key = objectKeyOf(head);
  if (!key) return undefined;
  const value = mapTsType(tail, allowNullish, typeParams);
  if (!value) return undefined;
  return {
    kind: "property",
    key: key.key,
    value,
    ...(key.optional ? { optional: true } : {}),
    ...(/^readonly\s+/.test(head) ? { readonly: true } : {}),
  };
}

/**
 * {@link ObjectMember} 列表 → Abs。有调用 / 构造签名时发布 fn 形状（带
 * `slots`），否则发布开放 obj；访问器 getter 优先，仅 setter 时用参数域。
 */
function objectAbsOfMembers(members: readonly ObjectMember[]): Abs {
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  const getterKeys = new Set<string>();
  let index: Extract<Shape, { k: "obj" }>["index"];
  let call: Abs | undefined;
  let construct: Abs | undefined;
  for (const m of members) {
    switch (m.kind) {
      case "property":
        slots[m.key] = {
          value: m.value,
          ...(m.optional ? { optional: true } : {}),
          ...(m.readonly ? { readonly: true } : {}),
        };
        break;
      case "method":
        slots[m.key] = { value: m.value, ...(m.optional ? { optional: true } : {}) };
        break;
      case "get":
        slots[m.key] = { value: m.value };
        getterKeys.add(m.key);
        break;
      case "set":
        // getter / 属性已经给出读域时不覆盖；仅 setter 时用参数域（best effort）。
        if (!getterKeys.has(m.key) && !(m.key in slots)) slots[m.key] = { value: m.value };
        break;
      case "index":
        index = { key: m.key, value: m.value };
        break;
      case "call":
        call ??= m.value;
        break;
      case "construct":
        construct ??= m.value;
        break;
    }
  }
  const sig = call ?? construct;
  if (sig?.shape.k === "fn") {
    const s = sig.shape;
    const paramTypes = s.paramTypes ?? [];
    const returnType = s.returnType ?? absOf({ k: "any" });
    const fnAbs = absFunction(
      [...s.params],
      { relation: { paramTypes, returnType } },
      {
        paramTypes,
        returnType,
        ...(Object.keys(slots).length > 0 ? { slots } : {}),
        ctor: call === undefined && construct !== undefined,
        conf: "path",
      },
    );
    // 构造签名只保证 `new` 面；裸调用面的判据留给 call 路径（不在 fn 上
    // 写 `facets.callable = false`：`$new` 的 fn 分支也走 `$call`，会把
    // 合法 `new C(1)` 误判成裸调用）。
    return fnAbs;
  }
  return absOf({ k: "obj", slots, ...(index ? { index } : {}), open: true });
}

/** 具名类型的**实例结构**文本 → Abs 成员列表（`{…}` 包裹；extends 已摊平）。 */
function objectMembersOfTypeText(
  text: string | undefined,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): ObjectMember[] | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return undefined;
  const inner = t.slice(1, -1).trim();
  if (inner === "") return [];
  const parts = splitTopLevel(inner.replace(/;/g, ","), ",");
  const out: ObjectMember[] = [];
  for (const part of parts) {
    const m = objectMemberOfText(part, allowNullish, typeParams);
    if (m) out.push(m);
  }
  return out;
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
function mapTsType(
  text: string | undefined,
  allowNullish: boolean,
  typeParams?: ReadonlyMap<string, Abs>,
): Abs | undefined {
  if (!text) return undefined;
  const t = unwrapParens(text.trim());
  if (!t) return undefined;
  // 名字解析：类型参数 → 内建类型 → 同文件/导入声明 → `typeof` 值引用。
  const env = activeAnnotationEnv;
  const bound = env?.typeParams?.get(t) ?? env?.builtins?.get(t) ?? builtinTypeAbs(t);
  if (bound) return bound;
  const namedText = env?.namedTypes?.get(t);
  if (namedText !== undefined && namedText.trim() !== t && (env?.depth ?? 0) < 8) {
    const prev = activeAnnotationEnv;
    activeAnnotationEnv = { ...env, depth: (env?.depth ?? 0) + 1 };
    try {
      return mapTsType(namedText, allowNullish, typeParams);
    } finally {
      activeAnnotationEnv = prev;
    }
  }
  const typeofMatch = /^typeof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(t);
  if (typeofMatch) {
    const valueText = env?.valueTypes?.get(typeofMatch[1]!);
    if (valueText !== undefined && valueText.trim() !== t && (env?.depth ?? 0) < 8) {
      const prev = activeAnnotationEnv;
      activeAnnotationEnv = { ...env, depth: (env?.depth ?? 0) + 1 };
      try {
        return mapTsType(valueText, allowNullish, typeParams);
      } finally {
        activeAnnotationEnv = prev;
      }
    }
    return undefined;
  }

  // inline `import("spec").T`：名字不在本模块，文本由调用方的 import 表提供
  // （service 的 `inlineImportTypeTextsForFile`；core 不依赖 fs）。
  const inlineImport = /^import\(\s*["']([^"']+)["']\s*\)\s*\.\s*([A-Za-z_$][\w$]*)$/.exec(t);
  if (inlineImport) {
    const text = env?.importTypes?.get(`${inlineImport[1]}#${inlineImport[2]}`);
    if (text !== undefined && text.trim() !== t && (env?.depth ?? 0) < 8) {
      const prev = activeAnnotationEnv;
      activeAnnotationEnv = { ...env, depth: (env?.depth ?? 0) + 1 };
      try {
        return mapTsType(text, allowNullish, typeParams);
      } finally {
        activeAnnotationEnv = prev;
      }
    }
    return undefined;
  }

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
      // BUG-276 / provenance：用户显式写的 `unknown` 不是「推断失败」。
      // 用 provenance=declared 表达源码事实，不再借 term 旁路（term 会进
      // 指纹 / 等式语义，且嵌套 union/对象槽拿不到顶层标记）。
      return withProvenance(abs({ k: "unknown" }, undefined, undefined, "exact"), "declared");
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
  // `Map<K,V>` / `Set<T>` / `Promise<T>` / `Record<K,V>` / `WeakMap` …
  const genericBuiltin = builtinGenericAbs(bare, allowNullish);
  if (genericBuiltin) return genericBuiltin;

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
      // BUG-377：可选位元组不能塌成 `arr(元素并集)`——那会同时丢掉
      // **位置维度**（`t[0]` 变 `number | string`）与「可选位缺席」的
      // `undefined` 臂。TS 语义是每个合法长度一个元组臂：
      // `[number, string?]` = `[number] | [number, string]`。
      // 逐臂建模后，`t[0]` 仍是 number，`t[1]` 是 string | undefined。
      const firstOptional = parts.findIndex((p) => p.optional);
      const optionalCount = parts.filter((p) => p.optional).length;
      // 爆炸上限：可选位很多时逐长度展开不划算，退回旧的 arr 并集口径。
      if (firstOptional >= 0 && optionalCount <= 6) {
        const restIdx2 = parts.findIndex((p) => p.rest);
        const restParts = restIdx2 >= 0 ? parts.slice(restIdx2) : [];
        const prefixParts = parts.slice(0, firstOptional);
        const optionalParts = parts.slice(firstOptional, restIdx2 >= 0 ? restIdx2 : parts.length);
        const mapParts = (ps: typeof parts): Abs[] | undefined => {
          const out: Abs[] = [];
          for (const part of ps) {
            const mapped = mapTsType(part.text, allowNullish, typeParams);
            if (!mapped) return undefined;
            out.push(mapped);
          }
          return out;
        };
        const prefix = mapParts(prefixParts);
        const optionals = mapParts(optionalParts);
        if (prefix && optionals) {
          let rest: Abs | undefined;
          if (restParts.length > 0) {
            const tails: Abs[] = [];
            for (const part of restParts) {
              const mapped = mapTsType(part.text, allowNullish, typeParams);
              if (!mapped) return undefined;
              const s = mapped.shape;
              if (s.k === "arr") tails.push(s.element);
              else if (s.k === "tuple") {
                tails.push(...s.elements);
                if (s.rest) tails.push(s.rest);
              } else tails.push(mapped);
            }
            rest = tails.length > 0 ? joinAbsList(tails) : undefined;
          }
          const arms: Abs[] = [];
          for (let n = 0; n <= optionals.length; n++) {
            const elements = [...prefix, ...optionals.slice(0, n)];
            arms.push(abs({ k: "tuple", elements, ...(rest ? { rest } : {}) }, undefined, undefined, "exact"));
          }
          if (arms.length === 1) return arms[0]!;
          return abs({ k: "sum", members: arms }, undefined, undefined, "exact");
        }
      }
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
    // 成员分类单点：索引 / 调用 / 构造 / 访问器 / 方法 / 属性 / symbol。
    // 不可解析的成员不进槽，open 覆盖其未知面（见上方开放对象口径）。
    return objectAbsOfMembers(objectMembersOfTypeText(t, allowNullish, typeParams) ?? []);
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
  env?: AnnotationEnvArg,
): Shape | undefined {
  return withAnnotationEnv(env, () => mapTsType(text, false)?.shape);
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
  env?: AnnotationEnvArg,
): Abs | undefined {
  return withAnnotationEnv(env, () => mapTsType(text, true));
}

/** 结构面类型节点（Babel TSType 的纯数据视图；不依赖 @babel/types）。 */
type TsTypeNode = { type?: string; [key: string]: unknown };

function tsAnnotatedNode(node: TsTypeNode | undefined): TsTypeNode | undefined {
  if (!node) return undefined;
  if (node.type === "TSTypeAnnotation") {
    return (node as { typeAnnotation?: TsTypeNode }).typeAnnotation;
  }
  return node;
}

function tsNodeText(node: TsTypeNode | undefined, source: string | undefined): string | undefined {
  if (!node || !source) return undefined;
  return nodeTextOf(source, node as AstNode);
}

/** 计算键 / 普通键 → 槽键；well-known symbol 走 `@@name`。 */
function tsNodeKeyOf(node: TsTypeNode | undefined, computed: boolean): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  if (node.type === "NumericLiteral") return String(node.value);
  if (computed && node.type === "MemberExpression") {
    const obj = node.object as TsTypeNode | undefined;
    const prop = node.property as TsTypeNode | undefined;
    if (obj?.type === "Identifier" && obj.name === "Symbol" && prop?.type === "Identifier" && typeof prop.name === "string") {
      return `@@${prop.name}`;
    }
  }
  return undefined;
}

function tsNodeParamsOf(
  params: TsTypeNode[] | undefined,
  source: string | undefined,
  allowNullish: boolean,
): { names: string[]; types: Abs[]; optional: boolean[] } | undefined {
  const names: string[] = [];
  const types: Abs[] = [];
  const optional: boolean[] = [];
  for (const raw of params ?? []) {
    let p = raw;
    if (p.type === "TSParameterProperty") p = p.parameter as TsTypeNode;
    if (p.type === "Identifier" && p.name === "this") continue;
    let name: string | undefined;
    let ann: TsTypeNode | undefined;
    let opt = false;
    if (p.type === "Identifier" && typeof p.name === "string") {
      name = p.name;
      ann = tsAnnotatedNode(p.typeAnnotation as TsTypeNode | undefined);
      opt = p.optional === true;
    } else if (p.type === "AssignmentPattern") {
      const left = p.left as TsTypeNode | undefined;
      if (left?.type === "Identifier" && typeof left.name === "string") {
        name = left.name;
        ann = tsAnnotatedNode((left.typeAnnotation ?? p.typeAnnotation) as TsTypeNode | undefined);
        opt = true;
      }
    } else if (p.type === "RestElement") {
      const arg = p.argument as TsTypeNode | undefined;
      if (arg?.type === "Identifier" && typeof arg.name === "string") {
        name = arg.name;
        ann = tsAnnotatedNode((p.typeAnnotation ?? arg.typeAnnotation) as TsTypeNode | undefined);
      }
    }
    if (name === undefined) return undefined;
    const type = ann ? mapTsTypeNode(ann, source, allowNullish) : absOf({ k: "any" });
    if (!type) return undefined;
    names.push(name);
    types.push(type);
    optional.push(opt);
  }
  return { names, types, optional };
}

function tsNodeReturnOf(
  node: TsTypeNode | undefined,
  source: string | undefined,
  allowNullish: boolean,
): Abs | undefined {
  const ann = tsAnnotatedNode(node);
  if (!ann) return absOf({ k: "any" });
  return mapTsTypeNode(ann, source, allowNullish);
}

function tsNodeFn(
  params: TsTypeNode[] | undefined,
  returnType: TsTypeNode | undefined,
  source: string | undefined,
  allowNullish: boolean,
  ctor: boolean,
): Abs | undefined {
  const ps = tsNodeParamsOf(params, source, allowNullish);
  if (!ps) return undefined;
  const ret = tsNodeReturnOf(returnType, source, allowNullish);
  if (!ret) return undefined;
  if (ctor) {
    return absFunction(
      ps.names,
      { relation: { paramTypes: ps.types, returnType: ret } },
      { paramTypes: ps.types, returnType: ret, ctor: true, conf: "path" },
    );
  }
  return relationFn(ps.types, ret, {
    params: ps.names.map((n, i) => (ps.optional[i] ? `${n}?` : n)),
  });
}

function tsNodeMemberOf(
  member: TsTypeNode,
  source: string | undefined,
  allowNullish: boolean,
): ObjectMember | undefined {
  const kind = member.kind;
  const computed = member.computed === true;
  const key = tsNodeKeyOf(member.key as TsTypeNode | undefined, computed);
  if (member.type === "TSIndexSignature") {
    const keyAnn = tsAnnotatedNode(
      ((member.parameters as TsTypeNode[] | undefined)?.[0]?.typeAnnotation) as TsTypeNode | undefined,
    );
    const valAnn = tsAnnotatedNode(member.typeAnnotation as TsTypeNode | undefined);
    if (!keyAnn || !valAnn) return undefined;
    const keyAbs = mapTsTypeNode(keyAnn, source, allowNullish);
    const value = mapTsTypeNode(valAnn, source, allowNullish);
    return keyAbs && value ? { kind: "index", key: keyAbs, value } : undefined;
  }
  if (member.type === "TSCallSignatureDeclaration" || member.type === "TSConstructSignatureDeclaration") {
    const ctor = member.type === "TSConstructSignatureDeclaration";
    const fn = tsNodeFn(
      member.params as TsTypeNode[] | undefined,
      member.returnType as TsTypeNode | undefined,
      source,
      allowNullish,
      ctor,
    );
    return fn ? { kind: ctor ? "construct" : "call", value: fn } : undefined;
  }
  if (member.type === "TSGetterSignature" || member.type === "TSSetterSignature") {
    if (!key) return undefined;
    const isGet = member.type === "TSGetterSignature";
    if (isGet) {
      const ret = tsNodeReturnOf(member.returnType as TsTypeNode | undefined, source, allowNullish);
      return ret ? { kind: "get", key, value: ret } : undefined;
    }
    const ps = tsNodeParamsOf(member.params as TsTypeNode[] | undefined, source, allowNullish);
    return ps && ps.types.length > 0 ? { kind: "set", key, value: ps.types[0]! } : undefined;
  }
  if (member.type === "TSMethodSignature") {
    if (!key) return undefined;
    if (kind === "get") {
      const ret = tsNodeReturnOf(member.returnType as TsTypeNode | undefined, source, allowNullish);
      return ret ? { kind: "get", key, value: ret } : undefined;
    }
    if (kind === "set") {
      const ps = tsNodeParamsOf(member.params as TsTypeNode[] | undefined, source, allowNullish);
      return ps && ps.types.length > 0 ? { kind: "set", key, value: ps.types[0]! } : undefined;
    }
    const fn = tsNodeFn(
      member.params as TsTypeNode[] | undefined,
      member.returnType as TsTypeNode | undefined,
      source,
      allowNullish,
      false,
    );
    return fn ? { kind: "method", key, value: fn, ...(member.optional === true ? { optional: true } : {}) } : undefined;
  }
  if (member.type === "TSPropertySignature") {
    if (!key) return undefined;
    const ann = tsAnnotatedNode(member.typeAnnotation as TsTypeNode | undefined);
    if (!ann) return undefined;
    const value = mapTsTypeNode(ann, source, allowNullish);
    if (!value) return undefined;
    return {
      kind: "property",
      key,
      value,
      ...(member.optional === true ? { optional: true } : {}),
      ...(member.readonly === true ? { readonly: true } : {}),
    };
  }
  return undefined;
}

function tsNodeObjectAbs(
  members: TsTypeNode[] | undefined,
  source: string | undefined,
  allowNullish: boolean,
): Abs | undefined {
  const parsed: ObjectMember[] = [];
  for (const m of members ?? []) {
    const member = tsNodeMemberOf(m, source, allowNullish);
    if (member) parsed.push(member);
  }
  return objectAbsOfMembers(parsed);
}

function tsNodeInterfaceAbs(
  node: TsTypeNode,
  source: string | undefined,
  allowNullish: boolean,
): Abs | undefined {
  const body = node.body as TsTypeNode | undefined;
  const own = tsNodeObjectAbs(body?.body as TsTypeNode[] | undefined, source, allowNullish);
  if (!own) return undefined;
  const bases: Abs[] = [];
  for (const h of (node.extends as TsTypeNode[] | undefined) ?? []) {
    const expr = h.expression as TsTypeNode | undefined;
    const name = expr?.type === "Identifier" && typeof expr.name === "string" ? expr.name : undefined;
    if (!name || h.typeParameters !== undefined) continue;
    const baseNode = activeAnnotationEnv?.namedTypeNodes?.get(name);
    const text = activeAnnotationEnv?.namedTypes?.get(name);
    const base = baseNode
      ? mapTsTypeNode(baseNode, source, allowNullish)
      : text !== undefined
        ? mapTsType(text, allowNullish)
        : undefined;
    if (base) bases.push(base);
  }
  if (bases.length === 0) return own;
  const ownShape = own.shape;
  if (ownShape.k === "fn") return own;
  if (ownShape.k !== "obj") return own;
  const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
  let index: Extract<Shape, { k: "obj" }>["index"];
  for (const b of bases) {
    const bs = b.shape;
    if (bs.k !== "obj") continue;
    Object.assign(slots, bs.slots);
    if (bs.index) index = bs.index;
  }
  Object.assign(slots, ownShape.slots);
  if (ownShape.index) index = ownShape.index;
  return absOf({ k: "obj", slots, ...(index ? { index } : {}), open: true });
}

/** 迭代协议泛型的**节点面**映射（文本面仍由 builtinGenericAbs 负责，避免
 *  dts 值通道因 Abs 形状变化而丢掉注解实参）。 */
function tsNodeIteratorGeneric(
  name: string,
  typeParams: TsTypeNode | undefined,
  source: string | undefined,
  allowNullish: boolean,
): Abs | undefined {
  const params = typeParams?.params as TsTypeNode[] | undefined;
  const el = params?.[0] ? mapTsTypeNode(params[0], source, allowNullish) : absOf({ k: "any" });
  if (!el) return undefined;
  const iteratorMethod = (): Abs =>
    absFunction(
      [],
      { body: noBody, apply: (): Abs => abstractSeqIteratorAbs(el) },
      { ctor: false, paramTypes: [], returnType: abstractSeqIteratorAbs(el) },
    );
  switch (name) {
    case "Iterable":
    case "ReadonlyIterable":
      return absOf({
        k: "obj",
        open: true,
        slots: { "@@iterator": { value: iteratorMethod(), symbolKey: true } },
      });
    case "Iterator":
    case "IterableIterator":
    case "AsyncIterator":
    case "AsyncIterableIterator":
      return abstractSeqIteratorAbs(el);
    case "AsyncIterable":
      return absOf({
        k: "obj",
        open: true,
        slots: { "@@asyncIterator": { value: iteratorMethod(), symbolKey: true } },
      });
    default:
      return undefined;
  }
}

/**
 * 结构面：`TSType` 节点 → Abs。**未支持的种类**回落到源码文本映射（迁移期
 * fallback，不是第二套语义）；成员容器与函数类型优先走节点，避免把
 * `get` / `(x): T` / `new (x): T` / `[Symbol.iterator]` 重新交给文本二分。
 */
function mapTsTypeNode(
  node: TsTypeNode | undefined,
  source: string | undefined,
  allowNullish: boolean,
): Abs | undefined {
  const n = tsAnnotatedNode(node);
  if (!n) return undefined;
  switch (n.type) {
    case "TSTypeLiteral":
      return tsNodeObjectAbs((n.members as TsTypeNode[] | undefined) ?? [], source, allowNullish);
    case "TSInterfaceDeclaration":
      return tsNodeInterfaceAbs(n, source, allowNullish);
    case "TSTypeAliasDeclaration":
      return mapTsTypeNode(n.typeAnnotation as TsTypeNode | undefined, source, allowNullish);
    case "TSTypeReference": {
      const tn = n.typeName as TsTypeNode | undefined;
      const name =
        tn?.type === "Identifier" && typeof tn.name === "string" ? tn.name : undefined;
      if (!name) return undefined;
      const env = activeAnnotationEnv;
      const bound = env?.typeParams?.get(name) ?? env?.builtins?.get(name) ?? builtinTypeAbs(name);
      if (bound) return bound;
      const iteratorGeneric = tsNodeIteratorGeneric(
        name,
        n.typeParameters as TsTypeNode | undefined,
        source,
        allowNullish,
      );
      if (iteratorGeneric) return iteratorGeneric;
      const nodeDecl = env?.namedTypeNodes?.get(name);
      if (nodeDecl && (env?.depth ?? 0) < 8) {
        const prev = activeAnnotationEnv;
        activeAnnotationEnv = { ...env, depth: (env?.depth ?? 0) + 1 };
        try {
          return mapTsTypeNode(nodeDecl, source, allowNullish);
        } finally {
          activeAnnotationEnv = prev;
        }
      }
      const text = tsNodeText(n, source);
      return text ? mapTsType(text, allowNullish) : undefined;
    }
    case "TSUnionType": {
      const members = (n.types as TsTypeNode[] | undefined) ?? [];
      const mapped = members.map((m) => mapTsTypeNode(m, source, allowNullish));
      if (mapped.some((m) => m === undefined)) return undefined;
      return abs({ k: "sum", members: mapped as Abs[] }, undefined, undefined, "exact");
    }
    case "TSIntersectionType": {
      const members = (n.types as TsTypeNode[] | undefined) ?? [];
      const mapped = members.map((m) => mapTsTypeNode(m, source, allowNullish));
      if (mapped.some((m) => m === undefined)) return undefined;
      const shapes = mapped.map((m) => m!.shape);
      if (shapes.every((s) => s.k === "obj")) {
        const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
        let index: Extract<Shape, { k: "obj" }>["index"];
        for (const s of shapes as Array<Extract<Shape, { k: "obj" }>>) {
          Object.assign(slots, s.slots);
          if (s.index) index = s.index;
        }
        return absOf({ k: "obj", slots, ...(index ? { index } : {}), open: true });
      }
      return undefined;
    }
    case "TSArrayType": {
      const el = mapTsTypeNode(n.elementType as TsTypeNode | undefined, source, allowNullish);
      return el ? abs({ k: "arr", element: el }, undefined, undefined, "exact") : undefined;
    }
    case "TSTupleType": {
      const raw = (n.elementTypes as TsTypeNode[] | undefined) ?? (n.types as TsTypeNode[] | undefined) ?? [];
      // 可选位 / 标签位 / 混合 rest 的逐臂展开已由文本映射器实现（位置维度
      // 不能塌成固定元组）；迁移期回落到文本，避免节点路径另写一份口径。
      if (
        raw.some(
          (p) =>
            p.type === "TSOptionalType" ||
            p.type === "TSNamedTupleMember" ||
            p.type === "TSRestType",
        )
      ) {
        const text = tsNodeText(n, source);
        if (text) return mapTsType(text, allowNullish);
      }
      const els: Abs[] = [];
      for (const part of raw) {
        let p = part;
        let rest = false;
        let optional = false;
        if (p.type === "TSRestType") {
          rest = true;
          p = p.typeAnnotation as TsTypeNode;
        }
        if (p.type === "TSOptionalType") {
          optional = true;
          p = p.typeAnnotation as TsTypeNode;
        }
        const mapped = mapTsTypeNode(p, source, allowNullish);
        if (!mapped) return undefined;
        if (rest && mapped.shape.k === "arr") els.push(mapped.shape.element);
        else els.push(mapped);
        if (optional) els[els.length - 1] = joinAbsList([mapped, abs({ k: "unknown" }, undefined, undefined, "exact")]);
      }
      return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
    }
    case "TSFunctionType":
      return tsNodeFn(
        n.params as TsTypeNode[] | undefined,
        n.returnType as TsTypeNode | undefined,
        source,
        allowNullish,
        false,
      );
    case "TSConstructorType":
      return tsNodeFn(
        n.params as TsTypeNode[] | undefined,
        n.returnType as TsTypeNode | undefined,
        source,
        allowNullish,
        true,
      );
    case "TSParenthesizedType":
    case "TSOptionalType":
    case "TSRestType":
      return mapTsTypeNode(n.typeAnnotation as TsTypeNode | undefined, source, allowNullish);
    case "TSStringKeyword":
      return absOf({ k: "prim", type: "string" });
    case "TSNumberKeyword":
      return absOf({ k: "prim", type: "number" });
    case "TSBooleanKeyword":
      return absOf({ k: "prim", type: "boolean" });
    case "TSBigIntKeyword":
      return absOf({ k: "prim", type: "bigint" });
    case "TSSymbolKeyword":
      return absOf({ k: "prim", type: "symbol" });
    case "TSAnyKeyword":
      return absOf({ k: "any" });
    case "TSUnknownKeyword":
      return withProvenance(abs({ k: "unknown" }, undefined, undefined, "exact"), "declared");
    case "TSNeverKeyword":
      return absOf({ k: "never" });
    case "TSObjectKeyword":
      return absOf({ k: "obj", slots: {}, open: true });
    case "TSNullKeyword":
      return allowNullish ? nullishAbs(null) : undefined;
    case "TSUndefinedKeyword":
    case "TSVoidKeyword":
      return allowNullish ? nullishAbs(undefined) : undefined;
    default: {
      const text = tsNodeText(n, source);
      return text ? mapTsType(text, allowNullish) : undefined;
    }
  }
}

/**
 * 结构面注解入口：`TSTypeAnnotation` / `TSType` 节点 → Abs。
 * `source` 只用于未支持节点的文本 fallback；节点本身不保留、不进缓存。
 */
export function absTypeForTsTypeNode(
  node: unknown,
  env?: AnnotationEnvArg,
  source?: string,
): Abs | undefined {
  const n = node as TsTypeNode | undefined;
  if (!n) return undefined;
  return withAnnotationEnv(env, () => mapTsTypeNode(n, source, true));
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
