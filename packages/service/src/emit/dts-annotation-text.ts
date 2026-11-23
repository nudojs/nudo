/**
 * 源码类型注解的**引用分析**：类型名 / `typeof` 值名 / 内建 token 放行。
 *
 * 从 `dts-generator.ts` 抽出。函数投影与源码面扫描共用这一份判据：注解文本
 * 里的字符串字面量要遮蔽、数字字面量不是类型引用、属性键 / 方法名不是引用，
 * 否则同一个 `T` 会在形参位和字段位得到不同结论。
 */
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
import type { DtsModuleSurface } from "./dts-ir.ts";

/**
 * TS 类型文本里**不需要产物声明**的词（关键字 / 基元 / TS 内建类型名）。
 *
 * 判据来源：TS 关键字 + lib.d.ts 的全局类型名（与 `isRuntimeGlobalCtorName`
 * 的运行时构造器名单同源，另加工具类型与迭代协议）。
 */
export const TS_TYPE_TOKENS: ReadonlySet<string> = new Set([
  // 关键字 / 基元
  "string", "number", "boolean", "bigint", "symbol", "object", "unknown", "any",
  "never", "void", "undefined", "null", "this", "true", "false", "readonly",
  "keyof", "typeof", "infer", "extends", "in", "is", "asserts", "unique",
  "satisfies", "declare", "abstract", "const", "new", "import",
  // 工具类型 / 内建泛型
  "Array", "ReadonlyArray", "Promise", "PromiseLike", "Readonly", "Partial",
  "Required", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "Record",
  "Parameters", "ConstructorParameters", "ReturnType", "InstanceType",
  "ThisParameterType", "OmitThisParameter", "ThisType", "Awaited", "Uppercase",
  "Lowercase", "Capitalize", "Uncapitalize", "PropertyKey", "TemplateStringsArray",
  "ArrayLike", "Iterable", "Iterator", "IterableIterator", "AsyncIterable",
  "AsyncIterator", "AsyncIterableIterator", "Generator", "AsyncGenerator",
  "GeneratorFunction", "AsyncGeneratorFunction", "Map", "ReadonlyMap", "WeakMap",
  "Set", "ReadonlySet", "WeakSet", "WeakRef", "FinalizationRegistry",
  "JSON", "Math", "Reflect", "Intl", "Proxy",
  "Date", "RegExp", "Error", "EvalError", "RangeError", "ReferenceError",
  "SyntaxError", "TypeError", "URIError", "AggregateError", "URL", "URLSearchParams",
  // BUG-245：lib.*.d.ts 里的**纯类型**全局名（无运行时构造器）——它们和
  // `Date` / `RegExp` 一样是环境内建，产物无需声明。旧白名单只覆盖关键字、
  // 工具类型与运行时构造器 ⇒ `RegExpMatchArray` / `IArguments` /
  // `CallableFunction` / `PromiseSettledResult` 被判「未在本模块声明」而丢弃。
  "IArguments", "CallableFunction", "NewableFunction", "RegExpMatchArray",
  "RegExpExecArray", "PromiseSettledResult", "PromiseFulfilledResult",
  "PromiseRejectedResult", "Disposable", "AsyncDisposable", "DisposableStack",
  "AsyncDisposableStack", "SuppressedError", "WeakKey", "ArrayBufferView",
  "NodeJS",
]);

/**
 * 字符串 / 模板字面量里的**文本**替换成等长空格（BUG-191）。
 *
 * `annotationTypeRefs` 用正则抓标识符；字符串字面量类型里的文本
 * （`"a" | "b"` 的 `a`、`"ok"` 的 `ok`、`` `pre-${string}` `` 的 `pre`）会被
 * 当成类型引用 ⇒ 整条形参注解被判「引用了未在本模块声明的类型」而丢弃
 * （产物退成观测口径 `string` / `unknown`，消费方对错值零诊断）。
 *
 * 按 1 字符 → 1 字符遮蔽（保持下标不变，后缀判据仍可用于同一列）。模板串的
 * `${…}` 内部是**类型语法**（`` `${T}` `` 的 `T` 是真的类型引用）⇒ 内部文本
 * 原样保留，只遮蔽字面量文本段。
 */
function maskStringLiteralText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      out += " ";
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "`") {
      out += " ";
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === "`") {
          out += " ";
          i++;
          break;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          const end = templateExprEnd(text, i + 2);
          const inner = text.slice(i + 2, Math.min(end, text.length));
          const closed = end < text.length;
          out += `  ${maskStringLiteralText(inner)}${closed ? " " : ""}`;
          i = closed ? end + 1 : text.length;
          continue;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 模板串 `${` 之后到配对 `}` 的下标（字符串 / 嵌套模板串不参与配对）。 */
function templateExprEnd(text: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "`") {
          i++;
          break;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          i = templateExprEnd(text, i + 2) + 1;
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return text.length;
}

/**
 * 注解原文里引用的**类型名**（BUG-168）。
 *
 * 跳过：限定访问的后半段（`Intl.DateTimeFormat` 只解析 `Intl`——产物里要解析的
 * 只是根名）、对象类型里的**属性键** / 索引签名参数名（`{ a: number }` 的 `a`）、
 * 方法签名里的**成员名**（`{ m(): number }` / `{ m?(): number }` 的 `m`，
 * BUG-176）、字符串 / 模板字面量内部的文本（BUG-191）。
 * 其余标识符一律视为类型引用，由调用方核对「产物里可解析」。
 */
export function annotationTypeRefs(text: string): string[] {
  // BUG-353：字面量类型（`0xff` / `0b101` / `0o7` / `10n` / `1_000`）不是类型
  // 引用——数字后缀里的字母（`xff`）会被标识符正则误抓。数字段按等长空格
  // 遮蔽（与字符串遮蔽同机制），保持下标不变。
  const numericMasked = maskStringLiteralText(text).replace(
    /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)(?![\w$])/g,
    (m) => " ".repeat(m.length),
  );
  const masked = numericMasked;
  const out: string[] = [];
  for (const m of masked.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const name = m[0];
    const at = m.index ?? 0;
    if (at > 0 && masked[at - 1] === ".") continue;
    const after = masked.slice(at + name.length);
    // 属性键 / 索引签名参数名：`a: T` / `a?: T`
    if (/^\?*\s*:/.test(after)) continue;
    // 方法签名成员名：`m(): T` / `m?(): T` / `m<T>(): T`——名字是成员**键**，
    // 不是类型引用（`Foo<T>` 这种类型引用后面不会跟 `(`）。
    if (/^\?*\s*(?:<[^<>]*>\s*)?\(/.test(after)) continue;
    out.push(name);
  }
  return out;
}

/**
 * 注解里的**值命名空间**引用（`typeof defaults` / `keyof typeof defaults` /
 * `typeof handler` 里的 `defaults` / `handler`）。它们不是类型名，不能用
 * `typeNames` 判定（BUG-262）。
 */
export function typeofValueRefs(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  const masked = maskStringLiteralText(text);
  for (const m of masked.matchAll(/\btypeof\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * 类型名是否在产物里可解析：内建 token / 全局构造器 / 本地类 / import /
 * interface·type 别名。
 */
export function isTypeNameResolvable(
  name: string,
  surface: DtsModuleSurface | undefined,
): boolean {
  if (TS_TYPE_TOKENS.has(name) || isRuntimeGlobalCtorName(name)) return true;
  if (surface === undefined) return false;
  return (
    surface.classes.has(name) ||
    surface.imports?.has(name) === true ||
    surface.typeNames?.has(name) === true
  );
}

/**
 * 注解引用是否可解析：类型命名空间（本地类 / interface·type / import /
 * 内建）或——仅当该引用前面有 `typeof`——本模块的值命名空间（BUG-262）。
 */
export function isTypeRefResolvable(
  name: string,
  valuePosition: boolean,
  surface: DtsModuleSurface | undefined,
): boolean {
  if (isTypeNameResolvable(name, surface)) return true;
  return valuePosition && surface?.valueNames?.has(name) === true;
}
