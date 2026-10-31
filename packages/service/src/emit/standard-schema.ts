/**
 * Abs / SchemaNode → Standard Schema v1 运行时模块（单向有损投影）。
 *
 * 产物是零第三方依赖的 TS/JS 模块：每个导出实现 `~standard` Props
 * （version=1, vendor="nudo", validate）。validate 对 SchemaNode 做
 * 结构 + 可表达 refinement 执法；落不了的 pred 不在此假装精确。
 *
 * 协议：https://standardschema.dev —— 运行时互操作出口，不替代 nudo check。
 *
 * 不变量：
 * - **两份实现同口径**：库函数 `checkNode` 与生成产物内联的 `__nudoCheck` 是
 *   同一套语义的两份拷贝（Bug 528）——改一处必须同步改另一处（判据、消息、
 *   遍历原语都要一致）。
 * - **永不抛**：Standard Schema v1 要求 `validate` **返回** Result 而非抛异常
 *   （Bug 551）——入参可能是 bigint / 循环结构 / 带抛错 getter 的对象，消息
 *   构造与取值都必须不抛。
 * - **与 zod 面同判据**：元组定长（Bug 522）、brand 的 `instanceof`（531）、
 *   `fn` 的 `typeof`（535）、对象键存在性的 HasProperty 语义（549）——
 *   同一个 Abs 在两个方言里不得给出相反裁决。
 * - **产物可编译**：产物后缀是 `.ts` ⇒ helper / 局部量必须自带类型标注，
 *   否则 strict 工程里 TS7006 / TS7005 / TS7034 一片红（Bug 519 / 989）。
 * - **字面量保真**：节点序列化**不走 JSON**（JSON 无非有限数表示、bigint 直接
 *   抛）——产物里的 lit 值必须与 Abs 一致（Bug 533 / 1000）。
 * - **入参面口径与 zod 面对齐**：`<fn>Input` 校验「整个入参对象」；解构形参的
 *   **字段**不提升为顶层整参校验器（Bug 539）。
 * - **返回面恒名**：`<fn>Output`（与 zod 面同名同义）——名字**不随符号来源翻转**
 *   （Bug 614：曾「有契约返回 ⇒ `<fn>Return`、走观测 ⇒ `<fn>Output`」）。
 * - **顶层形参可选性保真**：可选位（契约级 / 声明级）的整参校验器**接受
 *   `undefined`**（Bug 627）。
 */

import type { Abs, FormalParam } from "@nudojs/core";
import { sanitizeLineCommentText } from "./line-comment.ts";
import {
  absToSchemaNode,
  safeExportIdent,
  type SchemaNode,
  type SchemaRefinement,
} from "./schema-generator.ts";

export type StandardSchemaIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey>;
};

export type StandardSchemaResult =
  | { value: unknown; issues?: undefined }
  | { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined };

function pushIssue(
  issues: StandardSchemaIssue[],
  path: PropertyKey[],
  message: string,
): void {
  issues.push(path.length > 0 ? { message, path: [...path] } : { message });
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * 全局构造器 brand 名单 —— 与 zod 面（`schema-generator.ts` 的
 * `RUNTIME_GLOBAL_CTOR_NAMES`）**同名单**：只有这些 brand 有可靠的运行时判据
 * （`value instanceof Ctor`）；其余 brand（用户类 / GeneratorFunction / …）
 * 没有运行时判据 ⇒ 放行（`schema-generator` 已把它们降级为 `unknown` 并记
 * `dropped`，standard 面看不到它们）。
 */
const GLOBAL_BRAND_CTOR_NAMES: ReadonlyArray<string> = [
  "Array", "Object", "Function", "Boolean", "Number", "String", "Symbol", "BigInt",
  "Date", "RegExp",
  "Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError",
  "TypeError", "URIError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "Promise",
  "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
];
const GLOBAL_BRAND_CTOR_NAME_SET: ReadonlySet<string> = new Set(GLOBAL_BRAND_CTOR_NAMES);

/**
 * brand 判据：可判定（全局构造器）⇒ `value instanceof Ctor`；
 * 不可判定 / 该运行时缺此全局 ⇒ 放行（与 zod 面的 `z.unknown()` 同口径）。
 * **不抛**：非构造器（`instanceof` 的右值不可调用）也放行。
 */
function isBrandInstance(name: string, value: unknown): boolean {
  if (!GLOBAL_BRAND_CTOR_NAME_SET.has(name)) return true;
  const ctor = (globalThis as unknown as Record<string, unknown>)[name];
  if (typeof ctor !== "function") return true;
  try {
    return (value as object) instanceof ctor;
  } catch {
    return true;
  }
}

/**
 * 值的安全描述（**不抛**、**不丢非有限数值**）：
 * bigint → `"1n"`；`Infinity` / `-Infinity` / `NaN` → 原样文本（`JSON.stringify`
 * 会把它们写成 `null`）；循环结构 / 抛错的 `toJSON` → `"<unserializable>"`。
 */
function describeValue(value: unknown): string {
  try {
    if (typeof value === "bigint") return value.toString() + "n";
    // Bug 1065（同族漏点，收口时一并补）：`-0` 与 `0` 在 `===` 下等价，但除法 /
    // Math.sign / Object.is 上可观察 ⇒ 保真（与同文件 :538 的字面量序列化**同口径**，
    // 消除「同文件内部两套口径」）。
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (typeof value === "string") return JSON.stringify(value);
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return "function";
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  } catch {
    return "<unserializable>";
  }
}

/**
 * 键存在性（HasProperty 语义）：原型链上的**用户**键算「在场」，但
 * `Object.prototype` 自身的成员（污染键 `toString` / `constructor` /
 * `valueOf` …）**不算**在场（原型污染不是真实槽）。
 *
 * BUG-096：这条规则是**三面唯一口径**（此前注释自称与 zod 同口径，实测
 * `Object.create({ toString: "s" })` 被 zod 放行 ⇒ 注释与实现不符）：
 * - guard 面 = core `denote.ts` 的 `hasPropertyClause`（逐字等价子句）；
 * - standard 面 = 本函数 / 产物里的 `__nudoHasProperty`；
 * - zod 面 = `schema-generator.ts` 给**必填污染键槽**补的 `.superRefine`
 *   （`z.object` 原生用 `key in data`，含 Object.prototype 成员）。
 *
 * `Object.create({ c: 1 })` 有 `c`（用户原型键 ⇒ 在场，与 zod / TS 结构类型
 * 同裁决）；`{}` 的 `toString` 不算在场（三面都判 required）。
 */
function hasProperty(obj: Record<string, unknown>, key: string): boolean {
  if (Object.hasOwn(obj, key)) return true;
  if (!(key in obj)) return false;
  return !Object.hasOwn(Object.prototype, key);
}

function checkPrimRefinements(
  refinements: ReadonlyArray<{ kind: string; op?: string; n?: number }>,
  value: unknown,
  path: PropertyKey[],
  issues: StandardSchemaIssue[],
): void {
  if (typeof value !== "number" && typeof value !== "string") return;
  for (const r of refinements) {
    if (r.kind === "int") {
      if (typeof value === "number" && !Number.isInteger(value)) {
        pushIssue(issues, path, "expected integer");
      }
      continue;
    }
    if (r.kind === "numBound" && typeof value === "number" && typeof r.n === "number") {
      const n = r.n;
      const op = r.op;
      let ok = true;
      if (op === "gt") ok = value > n;
      else if (op === "ge") ok = value >= n;
      else if (op === "lt") ok = value < n;
      else if (op === "le") ok = value <= n;
      if (!ok) pushIssue(issues, path, `expected number ${op} ${n}, got ${value}`);
      continue;
    }
    if (r.kind === "strMin" && typeof value === "string" && typeof r.n === "number") {
      if (value.length < r.n) {
        pushIssue(issues, path, `expected string length >= ${r.n}, got ${value.length}`);
      }
      continue;
    }
    if (r.kind === "strMax" && typeof value === "string" && typeof r.n === "number") {
      if (value.length > r.n) {
        pushIssue(issues, path, `expected string length <= ${r.n}, got ${value.length}`);
      }
    }
  }
}

function checkNode(
  node: SchemaNode,
  value: unknown,
  path: PropertyKey[],
  issues: StandardSchemaIssue[],
): void {
  // Standard Schema v1：`validate` 永不抛（Bug 551）——入参可能是带抛错 getter
  // 的对象；异常一律降级成一条 issue。
  try {
    switch (node.k) {
      case "unknown":
        return;
      case "promise":
        // 同步投影不 unwrap thenable（无从得知是否已 resolved）——但**类型判据**
        // 必须与 zod 面（`z.promise` 自带 instanceof）/ guard 面
        // （`data instanceof Promise`）同口径，否则 standard 面放行一切非
        // Promise 值 ⇒ 同一 Abs 在两个方言里给出相反裁决（BUG-025）。
        if (!(value instanceof Promise)) {
          pushIssue(issues, path, `expected promise, got ${typeOf(value)}`);
        }
        return;
      case "fn":
        // 判据：是不是函数（zod 面 `z.function()` 同口径——不校验签名，只校验
        // 「是函数」）
        if (typeof value !== "function") {
          pushIssue(issues, path, `expected function, got ${typeOf(value)}`);
        }
        return;
      case "brand": {
        // 可判定的全局构造器 ⇒ `instanceof`（zod 面 `z.instanceof(X)` 同口径）；
        // 其余 brand 无运行时判据 ⇒ 放行
        if (!isBrandInstance(node.name, value)) {
          pushIssue(issues, path, `expected ${node.name}, got ${typeOf(value)}`);
        }
        return;
      }
      case "never":
        pushIssue(issues, path, "expected never");
        return;
      case "lit": {
        const expected = node.value;
        const same =
          expected === value ||
          (typeof expected === "number" &&
            typeof value === "number" &&
            Number.isNaN(expected) &&
            Number.isNaN(value));
        if (!same) {
          pushIssue(
            issues,
            path,
            `expected ${describeValue(expected)}, got ${describeValue(value)}`,
          );
        }
        return;
      }
      case "prim": {
        const t = node.type;
        const actual = typeOf(value);
        const ok =
          (t === "number" && actual === "number") ||
          (t === "string" && actual === "string") ||
          (t === "boolean" && actual === "boolean") ||
          (t === "bigint" && actual === "bigint") ||
          (t === "symbol" && actual === "symbol");
        if (!ok) {
          pushIssue(issues, path, `expected ${t}, got ${actual}`);
          return;
        }
        checkPrimRefinements(node.refinements, value, path, issues);
        return;
      }
      case "obj": {
        // BUG-258：**数组视图**（RegExpExecArray 等）要求值**是数组**；普通对象
        // 判据反过来排除数组（"expected object, got array"）⇒ 不分支会把真实
        // 返回值判成违规（假红），而 guard / dts / zod 三面都判定它是数组。
        // 槽仍按自有属性 / 下标读：原生 exec 结果的 0..n-1 / length / index /
        // input / groups 全是自有属性 ⇒ 下面的逐槽判据无需改动。
        if (node.arrayView) {
          if (!Array.isArray(value)) {
            pushIssue(issues, path, `expected array, got ${typeOf(value)}`);
            return;
          }
        } else if (typeof value !== "object" || value === null || Array.isArray(value)) {
          pushIssue(issues, path, `expected object, got ${typeOf(value)}`);
          return;
        }
        const rec = value as Record<string, unknown>;
        for (const slot of node.slots) {
          const key = slot.key;
          // 键存在性：HasProperty 语义（用户原型上的真实键算「在场」）**减去**
          // Object.prototype 自身的污染键（Bug 549 / BUG-096）——与 guard 面
          // 的「存在性子句」、zod 面的 `.superRefine` 三面同判据（见 hasProperty）
          if (!hasProperty(rec, key)) {
            if (!slot.optional) pushIssue(issues, [...path, key], "required");
            continue;
          }
          // 键在场：optional 槽显式 undefined 合法（zod .optional() 口径）；
          // 其余显式 undefined 交给 node 裁决（lit undefined / union undefined 臂）
          if (rec[key] === undefined && slot.optional) continue;
          checkNode(slot.node, rec[key], [...path, key], issues);
        }
        return;
      }
      case "arr": {
        if (!Array.isArray(value)) {
          pushIssue(issues, path, `expected array, got ${typeOf(value)}`);
          return;
        }
        // BUG-094：数组**自身**的长度界（guard 面一直保留，另两面此前整段丢）
        if (typeof node.minLen === "number" && value.length < node.minLen) {
          pushIssue(
            issues,
            path,
            `expected array length >= ${node.minLen}, got ${value.length}`,
          );
        }
        if (typeof node.maxLen === "number" && value.length > node.maxLen) {
          pushIssue(
            issues,
            path,
            `expected array length <= ${node.maxLen}, got ${value.length}`,
          );
        }
        // 索引循环（与生成产物内联版同口径）：稀疏洞读作 `undefined` ⇒ 按元素
        // 类型报错（与 zod 面 / 引擎把洞实体化成 undefined 一致）
        for (let i = 0; i < value.length; i++) {
          checkNode(node.element, value[i], [...path, i], issues);
        }
        return;
      }
      case "tuple": {
        if (!Array.isArray(value)) {
          pushIssue(issues, path, `expected tuple, got ${typeOf(value)}`);
          return;
        }
        // 定长元组：长度必须与 elements 一致（引擎 `leqAbs` 的 tuple arity 判定
        // 与 zod 面的 `z.tuple` 同口径——Bug 522）
        if (!node.rest && value.length !== node.elements.length) {
          pushIssue(
            issues,
            path,
            `expected tuple of length ${node.elements.length}, got ${value.length}`,
          );
          return;
        }
        for (let i = 0; i < node.elements.length; i++) {
          checkNode(node.elements[i]!, value[i], [...path, i], issues);
        }
        // rest 槽：超长元素按 rest 校验（`[1, ...number]` 拒绝 `[1, "x"]`）。
        if (node.rest) {
          for (let i = node.elements.length; i < value.length; i++) {
            checkNode(node.rest, value[i], [...path, i], issues);
          }
        }
        return;
      }
      case "union": {
        for (const m of node.members) {
          const local: StandardSchemaIssue[] = [];
          checkNode(m, value, path, local);
          if (local.length === 0) return;
        }
        pushIssue(
          issues,
          path,
          `expected one of ${node.members.length} union members, got ${typeOf(value)}`,
        );
        return;
      }
      default:
        return;
    }
  } catch {
    pushIssue(issues, path, "validation failed");
  }
}

/** SchemaNode 同步校验（生成模块与测试共用语义）。 */
export function validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult {
  const issues: StandardSchemaIssue[] = [];
  checkNode(node, value, [], issues);
  return issues.length === 0 ? { value } : { issues };
}

/** 内联进生成模块的校验器源码（与 validateSchemaNode 同逻辑的紧凑版）。 */
const CHECK_FN_SOURCE = `
// 产物是 .ts 模块：helper 必须自带类型标注，否则 strict 工程里
// TS7006 / TS7005 / TS7034 一片红（Bug 519 / 989）。
type NudoSchemaNode =
  | { k: "lit"; value: unknown }
  | { k: "prim"; type: "number" | "string" | "boolean" | "bigint" | "symbol"; refinements: readonly NudoRefinement[] }
  | { k: "obj"; slots: readonly NudoSlot[]; arrayView?: boolean }
  | { k: "arr"; element: NudoSchemaNode; minLen?: number; maxLen?: number }
  | { k: "tuple"; elements: readonly NudoSchemaNode[]; rest?: NudoSchemaNode }
  | { k: "union"; members: readonly NudoSchemaNode[] }
  | { k: "promise"; inner: NudoSchemaNode }
  | { k: "brand"; name: string }
  | { k: "fn" }
  | { k: "summarized" }
  | { k: "never" }
  | { k: "unknown" };
type NudoSlot = { key: string; node: NudoSchemaNode; optional?: boolean };
type NudoRefinement =
  | { kind: "numBound"; op: "gt" | "ge" | "lt" | "le"; n: number }
  | { kind: "int" }
  | { kind: "strMin"; n: number }
  | { kind: "strMax"; n: number };
type NudoIssue = { message: string; path?: (string | number)[] };
function __nudoTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
// 全局构造器 brand 名单（与库函数版 GLOBAL_BRAND_CTOR_NAMES 同名单）——
// 只有这些 brand 有可靠的运行时判据（instanceof），其余放行。
const __nudoBrandCtors = ${JSON.stringify(GLOBAL_BRAND_CTOR_NAMES)};
// 全局作用域（按名查构造器；该运行时没有此全局 ⇒ 放行）。
const __nudoGlobalScope = (typeof globalThis !== "undefined" ? globalThis : {}) as unknown as Record<string, unknown>;
// 值的安全描述：不抛、且不丢非有限数值（JSON.stringify 会把 Infinity 写成 null）。
// -0 与 0 在 === 下等价，但除法 / Math.sign / Object.is 上可观察 ⇒ 保真
// （与库函数版 describeValue 同口径——两份实现的消息必须逐字一致）。
function __nudoDescribe(v: unknown): string {
  try {
    if (typeof v === "bigint") return v.toString() + "n";
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (typeof v === "string") return JSON.stringify(v);
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "symbol") return v.toString();
    if (typeof v === "function") return "function";
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return "<unserializable>";
  }
}
// 键存在性：原型链上的用户键算「在场」，Object.prototype 自身的成员不算
// （BUG-096：与产物里的 __nudoCheck 逐字同口径 + guard 面 / zod 面同规则）
function __nudoHasProperty(o: Record<string, unknown>, key: string): boolean {
  if (Object.hasOwn(o, key)) return true;
  if (!(key in o)) return false;
  return !Object.hasOwn(Object.prototype, key);
}
function __nudoCheck(node: NudoSchemaNode, value: unknown, path: (string | number)[], issues: NudoIssue[]): void {
  function push(msg: string): void {
    issues.push(path.length > 0 ? { message: msg, path: path.slice() } : { message: msg });
  }
  // Standard Schema v1：validate 永不抛——异常一律降级成一条 issue。
  try {
  switch (node.k) {
    case "unknown":
    case "summarized":
      return;
    case "promise":
      if (!(value instanceof Promise)) { push("expected promise, got " + __nudoTypeOf(value)); }
      return;
    case "fn":
      if (typeof value !== "function") { push("expected function, got " + __nudoTypeOf(value)); }
      return;
    case "brand": {
      const name = node.name;
      if (__nudoBrandCtors.indexOf(name) < 0) return;
      const ctor = __nudoGlobalScope[name];
      if (typeof ctor !== "function") return;
      if (!((value as object) instanceof ctor)) {
        push("expected " + name + ", got " + __nudoTypeOf(value));
      }
      return;
    }
    case "never":
      push("expected never");
      return;
    case "lit": {
      const expected = node.value;
      const same = expected === value ||
        (typeof expected === "number" && typeof value === "number" &&
          Number.isNaN(expected) && Number.isNaN(value));
      if (!same) push("expected " + __nudoDescribe(expected) + ", got " + __nudoDescribe(value));
      return;
    }
    case "prim": {
      const t = node.type;
      const actual = __nudoTypeOf(value);
      const ok =
        (t === "number" && actual === "number") ||
        (t === "string" && actual === "string") ||
        (t === "boolean" && actual === "boolean") ||
        (t === "bigint" && actual === "bigint") ||
        (t === "symbol" && actual === "symbol");
      if (!ok) { push("expected " + t + ", got " + actual); return; }
      for (const r of node.refinements || []) {
        if (r.kind === "int" && typeof value === "number" && !Number.isInteger(value)) {
          push("expected integer");
        } else if (r.kind === "numBound" && typeof value === "number" && typeof r.n === "number") {
          var okB = true;
          if (r.op === "gt") okB = value > r.n;
          else if (r.op === "ge") okB = value >= r.n;
          else if (r.op === "lt") okB = value < r.n;
          else if (r.op === "le") okB = value <= r.n;
          if (!okB) push("expected number " + r.op + " " + r.n + ", got " + value);
        } else if (r.kind === "strMin" && typeof value === "string" && typeof r.n === "number") {
          if (value.length < r.n) push("expected string length >= " + r.n + ", got " + value.length);
        } else if (r.kind === "strMax" && typeof value === "string" && typeof r.n === "number") {
          if (value.length > r.n) push("expected string length <= " + r.n + ", got " + value.length);
        }
      }
      return;
    }
    case "obj": {
      // BUG-258：数组视图要求值是数组（普通对象判据反过来排除数组）——
      // 与库函数版同口径。
      if (node.arrayView) {
        if (!Array.isArray(value)) { push("expected array, got " + __nudoTypeOf(value)); return; }
      } else if (typeof value !== "object" || value === null || Array.isArray(value)) {
        push("expected object, got " + __nudoTypeOf(value));
        return;
      }
      const rec = value as Record<string, unknown>;
      for (const slot of node.slots) {
        const key = slot.key;
        // 键存在性：HasProperty 语义（用户原型上的真实键算在场）减去
        // Object.prototype 的污染键（两份实现须同口径）
        if (!__nudoHasProperty(rec, key)) {
          if (!slot.optional) { path.push(key); push("required"); path.pop(); }
          continue;
        }
        if (rec[key] === undefined && slot.optional) continue;
        path.push(key);
        __nudoCheck(slot.node, rec[key], path, issues);
        path.pop();
      }
      return;
    }
    case "arr": {
      if (!Array.isArray(value)) { push("expected array, got " + __nudoTypeOf(value)); return; }
      // BUG-094：数组自身长度界（与库函数版同口径）
      if (typeof node.minLen === "number" && value.length < node.minLen) {
        push("expected array length >= " + node.minLen + ", got " + value.length);
      }
      if (typeof node.maxLen === "number" && value.length > node.maxLen) {
        push("expected array length <= " + node.maxLen + ", got " + value.length);
      }
      // 索引循环：稀疏洞读作 undefined（与库函数版 / zod 面同口径）
      for (let i = 0; i < value.length; i++) {
        path.push(i);
        __nudoCheck(node.element, value[i], path, issues);
        path.pop();
      }
      return;
    }
    case "tuple": {
      if (!Array.isArray(value)) { push("expected tuple, got " + __nudoTypeOf(value)); return; }
      // 定长元组：长度必须与 elements 一致（引擎 leqAbs / zod z.tuple 同口径）
      if (!node.rest && value.length !== node.elements.length) {
        push("expected tuple of length " + node.elements.length + ", got " + value.length);
        return;
      }
      for (let i = 0; i < node.elements.length; i++) {
        path.push(i);
        __nudoCheck(node.elements[i], value[i], path, issues);
        path.pop();
      }
      if (node.rest) {
        for (var ri = node.elements.length; ri < value.length; ri++) {
          path.push(ri);
          __nudoCheck(node.rest, value[ri], path, issues);
          path.pop();
        }
      }
      return;
    }
    case "union": {
      for (const m of node.members) {
        const local: NudoIssue[] = [];
        __nudoCheck(m, value, path, local);
        if (local.length === 0) return;
      }
      push("expected one of " + node.members.length + " union members, got " + __nudoTypeOf(value));
      return;
    }
    default:
      return;
  }
  } catch {
    push("validation failed");
  }
}
`.trim();

/**
 * 字面量值 → 源码文本（**保真**）。
 *
 * JSON 不是可用的落地格式：`JSON.stringify(Infinity)` → `"null"`（静默换人）、
 * `JSON.stringify(10n)` → 直接抛 `TypeError`（Bug 533 / 1000）。产物是 TS
 * 源码，`Infinity` / `-Infinity` / `NaN` / `10n` 都是合法表达式 ⇒ 直接写源码。
 */
function literalValueSource(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return `${value.toString()}n`;
    case "number":
      if (Number.isNaN(value)) return "NaN";
      if (value === Infinity) return "Infinity";
      if (value === -Infinity) return "-Infinity";
      // -0 与 0 在 `===` 下等价，但除法 / Math.sign / Object.is 上可观察 ⇒ 保真
      return Object.is(value, -0) ? "-0" : String(value);
    default:
      // Abs 的 lit 值域是 string|number|boolean|bigint|null|undefined
      // （core `LiteralValue`）——symbol / function 不该出现；真出现时落 undefined
      // 而不是让 JSON.stringify 静默写成 null。
      return "undefined";
  }
}

/** refinement → 源码文本（与 `SchemaRefinement` 同构）。 */
function refinementSource(r: SchemaRefinement): string {
  switch (r.kind) {
    case "numBound":
      return `{"kind":"numBound","op":${JSON.stringify(r.op)},"n":${literalValueSource(r.n)}}`;
    case "int":
      return `{"kind":"int"}`;
    case "strMin":
      return `{"kind":"strMin","n":${literalValueSource(r.n)}}`;
    case "strMax":
      return `{"kind":"strMax","n":${literalValueSource(r.n)}}`;
  }
}

/**
 * SchemaNode → 内联源码（对象字面量文本）。
 *
 * 产物与运行时同构的前提是「Abs 的字面量值可表示」——对 string / 有限 number /
 * boolean / null / undefined 成立，对 **Infinity / -Infinity / NaN / bigint 不成立**
 * （Bug 1000）。故这里逐节点写源码文本，绝不经过 JSON 往返。
 */
function schemaNodeSource(node: SchemaNode): string {
  switch (node.k) {
    case "lit":
      return `{"k":"lit","value":${literalValueSource(node.value)}}`;
    case "prim":
      return `{"k":"prim","type":${JSON.stringify(node.type)},"refinements":[${node.refinements
        .map(refinementSource)
        .join(",")}]}`;
    case "obj":
      // BUG-258：数组视图标记必须随节点序列化——丢了它，产物按普通对象判据
      // 拒绝真实数组（"expected object, got array"）。
      return `{"k":"obj","slots":[${node.slots
        .map(
          (s) =>
            `{"key":${JSON.stringify(s.key)},"node":${schemaNodeSource(s.node)}${
              s.optional ? ',"optional":true' : ""
            }}`,
        )
        .join(",")}]${node.arrayView ? ',"arrayView":true' : ""}}`;
    case "arr":
      // BUG-094：长度界随节点序列化（丢它 = zod / standard 面放行违约数组）
      return `{"k":"arr","element":${schemaNodeSource(node.element)}${
        typeof node.minLen === "number" ? `,"minLen":${literalValueSource(node.minLen)}` : ""
      }${typeof node.maxLen === "number" ? `,"maxLen":${literalValueSource(node.maxLen)}` : ""}}`;
    case "tuple":
      // 末尾的 `}` 是**对象字面量的收尾**（不是插值表达式的收尾）——少了它
      // 产出的节点文本缺右括号 ⇒ 整个 tuple 产物是语法错误。
      return `{"k":"tuple","elements":[${node.elements.map(schemaNodeSource).join(",")}]${
        node.rest ? `,"rest":${schemaNodeSource(node.rest)}` : ""
      }}`;
    case "union":
      return `{"k":"union","members":[${node.members.map(schemaNodeSource).join(",")}]}`;
    case "promise":
      return `{"k":"promise","inner":${schemaNodeSource(node.inner)}}`;
    case "brand":
      return `{"k":"brand","name":${JSON.stringify(node.name)}}`;
    case "fn":
      return `{"k":"fn"}`;
    case "never":
      return `{"k":"never"}`;
    case "unknown":
      return `{"k":"unknown"}`;
  }
}

function makeStandardSchemaSource(
  exportName: string,
  node: SchemaNode,
  dropped: string[],
  used: Set<string>,
): string {
  // 节点走**保真序列化**（不是 JSON.stringify）：JSON 没有非有限数的表示
  // （Infinity → null）、bigint 直接抛（Bug 533 / 1000）。
  const nodeText = schemaNodeSource(node);
  const notes =
    dropped.length > 0
      ? dropped.map((d) => `//   ${sanitizeLineCommentText(d)}`).join("\n") + "\n"
      : "";
  return `${notes}export const ${safeExportIdent(exportName, used)} = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value: unknown) {
      const issues: NudoIssue[] = [];
      __nudoCheck(${nodeText}, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;`;
}

export type StandardSchemaModuleProjection = {
  source: string;
  dropped: string[];
};

/**
 * 标准面入参条目：整参（`param`）或**解构形参的字段**（`field`）。
 *
 * 契约的 `params` 列表在**解构形参**下装的是**字段**（`{ a, b }` ⇒ 契约条目
 * `a` / `b`），不是函数的形参。把字段级类型提升成顶层**整参**校验器 ⇒ 字段级
 * 校验器冒充整参（`act_a.validate({a:1,b:2})` 拒正确入参、`act_a.validate(1)`
 * 放行错误入参，双向都错）——Bug 539。
 *
 * `optional`：**顶层形参可选性**（Bug 627）——契约级（`number().optional()`）或
 * 声明级（默认形参）。缺省（undefined）= 必填。
 */
export type StandardSchemaInputEntry =
  | { kind: "param"; name: string; abs: Abs; optional?: boolean }
  | { kind: "field"; name: string; abs: Abs; optional?: boolean };

/**
 * 标准面**函数级**装配描述（入参面 + 返回面）。
 *
 * - `inputs`：契约 / 证据的入参条目（名字 + Abs + 可选性标记）
 * - `formals`：形参表面（解构形参的判据；缺省 = 全部当整参）
 * - `returns` / `output`：返回面（**恒名** `<fn>Output`——见下）
 */
export type StandardSchemaFunctionSpec = {
  /** 函数名（导出名前缀） */
  fn: string;
  /**
   * 入参条目（契约 / 证据）。
   *
   * `optional`：**顶层形参可选性**（Bug 627）——契约级可选（`constraint.isOptional`
   * 的直传，同 dts 面的 `DtsContractFace.params[].optional` 口径）。`constraintToEntryAbs`
   * 对标量契约**丢掉** isOptional（entry Abs 里没有该信息）⇒ 可选性必须由
   * 契约面显式带过来；缺省（undefined）= 该位必填。
   */
  inputs?: ReadonlyArray<{ name: string; abs: Abs; optional?: boolean }>;
  /** 形参表面（`{ a, b }` 这类 pattern 形参的绑定名 = 字段判据） */
  formals?: ReadonlyArray<FormalParam>;
  /** 契约返回约束（内容来源；导出名恒为 `<fn>Output`） */
  returns?: Abs;
  /** 观测 / 推导的返回 Abs（内容来源；导出名恒为 `<fn>Output`） */
  output?: Abs;
};

/**
 * 声明级可选性：默认形参（`function f(a, b = 2)`）可省略 ⇒ 该位可选。
 *
 * 与 dts 面同口径（dts 的 `?` 由「契约级 > 声明级 > 观测级」三来源决定）——
 * 声明级这一路在 standard 面此前**整条缺失**（Bug 627）。
 */
function declarationOptional(formals: ReadonlyArray<FormalParam> | undefined, name: string): boolean {
  // BUG-169：两个来源都要认 ——
  // ① JS 默认值（`kind === "default"`，`function f(a, b = 2)`）；
  // ② **TS 可选标记**（`b?: T`，`kind === "id"` + `optional: true`，
  //    由 core `tsOptionalParams` 从源码文本判定——`?` 在 strip-types 阶段
  //    就被删，不进 `kind`）。
  // 只认 ① 时，`f({ a: 1 })` 会被运行时校验器判 `required: b`（假红）。
  return (formals ?? []).some((f) => {
    if (f.kind === "default") return f.name === name;
    return f.kind === "id" && f.optional === true && f.name === name;
  });
}

/**
 * 契约条目 → 整参 / 解构字段的分类。
 *
 * 判据 = 形参表面：pattern 形参（`{ a, b }`）的顶层绑定名（`bound`）与属性键
 * （`propKey`）——契约里以这些名字出现的条目是**字段级**，不是函数的形参。
 *
 * 可选性（Bug 627）两来源合并：**契约级**（`inputs[].optional`）∪ **声明级**
 * （默认形参）——任一为真即该位可选。
 */
function classifyStandardSchemaInputs(
  inputs: ReadonlyArray<{ name: string; abs: Abs; optional?: boolean }>,
  formals: ReadonlyArray<FormalParam> | undefined,
): StandardSchemaInputEntry[] {
  const patterns = (formals ?? []).filter(
    (f): f is Extract<FormalParam, { kind: "pattern" }> => f.kind === "pattern",
  );
  return inputs.map((i) => {
    const isField = patterns.some(
      (f) => f.bound.includes(i.name) || Object.hasOwn(f.propKey, i.name),
    );
    const optional = i.optional === true || declarationOptional(formals, i.name);
    return isField
      ? { kind: "field", name: i.name, abs: i.abs, optional }
      : { kind: "param", name: i.name, abs: i.abs, optional };
  });
}

/**
 * 可选位 → 允许 `undefined` 的节点（`T | undefined`）。
 *
 * Bug 627：顶层形参的导出走的是**独立值节点**（不是对象槽）⇒ 结构上**无处挂
 * `optional`** ⇒ 契约允许的 `undefined` 被运行时拒收（`act_x.validate(undefined)`
 * ⇒ REJECT）。这里把可选位包成「并集（节点 + `undefined`）」——与 zod 面
 * `.optional()`（= `T | undefined`）**同判据**。
 */
function optionalNode(node: SchemaNode): SchemaNode {
  return { k: "union", members: [node, { k: "lit", value: undefined }] };
}

/** 模块装配（banner + helper + 导出体）——两个入口共用。 */
function standardSchemaModuleSource(
  bodies: string[],
  dropped: string[],
  opts?: { banner?: string },
): StandardSchemaModuleProjection {
  const banner =
    opts?.banner ??
    `// @generated by nudo export --format standard — Standard Schema v1 (vendor: nudo)\n// One-way lossy projection of Abs; do not edit. nudo check remains the gate.`;
  const source = `${banner}

${CHECK_FN_SOURCE}

${bodies.join("\n\n")}
`;
  return { source, dropped };
}

/**
 * Abs → Standard Schema v1 模块源码。
 * `exports`：导出名 → Abs（通常是 output / 各参数）。
 */
export function absToStandardSchemaModule(
  exports: Record<string, Abs>,
  opts?: { banner?: string },
): StandardSchemaModuleProjection {
  const dropped: string[] = [];
  const bodies: string[] = [];
  const used = new Set<string>();
  for (const [name, abs] of Object.entries(exports)) {
    const { node, dropped: d } = absToSchemaNode(abs);
    dropped.push(...d.map((n) => `${name}: ${n}`));
    bodies.push(makeStandardSchemaSource(name, node, d.map((n) => `${name}: ${n}`), used));
  }
  return standardSchemaModuleSource(bodies, dropped, opts);
}

/**
 * Abs → Standard Schema v1 **函数级**模块源码（入参面 + 返回面）。
 *
 * 导出名口径（与 zod 面对齐，`<fn>Input` / `<fn>Output` 同名同义）：
 * - `<fn>_<param>`：**整参**校验器（一个形参一个）
 * - `<fn>Input`：**整个入参对象**的校验器（入参条目的对象投影）
 * - `<fn>Output`：**返回面**校验器（**恒名**——内容取契约返回，否则取观测返回）
 *
 * Bug 614：返回面的**符号名**曾与**符号来源**耦合（有契约返回叫 `<fn>Return`，
 * 走观测叫 `<fn>Output`）⇒ 同一函数在不同源码状态下拿到**不同名字**，
 * 下游 `import { <fn>Output } from "*.nudo.standard"` 直接报错（而同一次导出的
 * zod 面恒叫 `<fn>Output` ⇒ 两面同物异名）。名字与来源解耦 ⇒ **恒叫
 * `<fn>Output`**（内容仍按「契约返回优先」取值）。
 *
 * **解构形参的字段不提升为顶层整参校验器**（Bug 539）：字段级校验器与整参校验器
 * 同名同形、语义却不同，消费方必然误用；字段只进 `<fn>Input`。
 *
 * **顶层形参的可选性保真**（Bug 627）：可选位（契约级 `number().optional()` 或
 * 声明级默认形参）的整参校验器**接受 `undefined`**（`T | undefined`，与 zod 面
 * `.optional()` 同判据），`<fn>Input` 的对应槽位带 `optional`（键可缺席）。
 */
export function absToStandardSchemaFunction(
  spec: StandardSchemaFunctionSpec,
  opts?: { banner?: string },
): StandardSchemaModuleProjection {
  const dropped: string[] = [];
  const bodies: string[] = [];
  const used = new Set<string>();
  const entries = classifyStandardSchemaInputs(spec.inputs ?? [], spec.formals);

  // 整参：`<fn>_<param>`（字段级条目跳过——见上方不变量）
  for (const e of entries) {
    if (e.kind !== "param") continue;
    const { node, dropped: d } = absToSchemaNode(e.abs);
    const notes = d.map((n) => `${spec.fn}_${e.name}: ${n}`);
    dropped.push(...notes);
    bodies.push(
      makeStandardSchemaSource(
        `${spec.fn}_${e.name}`,
        e.optional === true ? optionalNode(node) : node,
        notes,
        used,
      ),
    );
  }

  // 入参对象：`<fn>Input`（与 zod 面同口径：入参条目的对象投影）
  if (entries.length > 0) {
    const slots: Array<{ key: string; node: SchemaNode; optional?: boolean }> = [];
    for (const e of entries) {
      const { node, dropped: d } = absToSchemaNode(e.abs);
      dropped.push(...d.map((n) => `${spec.fn}Input: ${e.name}: ${n}`));
      slots.push(
        e.optional === true ? { key: e.name, node, optional: true } : { key: e.name, node },
      );
    }
    bodies.push(makeStandardSchemaSource(`${spec.fn}Input`, { k: "obj", slots }, [], used));
  }

  // 返回面：**恒名** `<fn>Output`（Bug 614：名字与来源解耦）；内容：契约返回
  // 优先，否则观测返回。
  if (spec.returns) {
    const { node, dropped: d } = absToSchemaNode(spec.returns);
    const notes = d.map((n) => `${spec.fn}Output: ${n}`);
    dropped.push(...notes);
    bodies.push(makeStandardSchemaSource(`${spec.fn}Output`, node, notes, used));
  } else if (spec.output) {
    const { node, dropped: d } = absToSchemaNode(spec.output);
    const notes = d.map((n) => `${spec.fn}Output: ${n}`);
    dropped.push(...notes);
    bodies.push(makeStandardSchemaSource(`${spec.fn}Output`, node, notes, used));
  }

  return standardSchemaModuleSource(bodies, dropped, opts);
}

/** 便捷：单个 Abs → 单导出模块（默认导出名 `schema`）。 */
export function absToStandardSchema(
  a: Abs,
  opts?: { name?: string },
): StandardSchemaModuleProjection {
  return absToStandardSchemaModule({ [opts?.name ?? "schema"]: a });
}
