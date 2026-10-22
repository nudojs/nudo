/**
 * 内部模块：字面量调用点扫描的**字面量判定层**（core algebra / scan）。
 *
 * 职责：把「谓词（Pred）× 实参值」裁决成 `true` / `false` / `undefined`
 * （不可判定）。本模块是族 11 拆出的三个内部模块之一，
 * **只在 core 包内被 `scan-literal-calls.ts` / `scan/literal-shapes.ts`
 * 相对 import**——**不新增任何 core 公开导出**。
 *
 * ── S0 共享契约（下游 S1 / S2 消费；改动前先读本段）────────────────────────
 *
 * **契约① 共享 ctx 对象**：`LiteralScanCtx` 定义在 **`scan/literal-args.ts`**
 * （本模块是**纯函数**模块：不需要 ctx）。字段固定为：
 *   - `out` / `knownFns` / `opts` / `source` / `file` / `varAbs` / `resolve`
 *   （语义见 `literal-args.ts` 文件头）。
 *
 * **契约② 零新增 core 导出**：本目录（`algebra/scan/`）下的模块**只被
 * `scan-literal-calls.ts` 相对 import**，不得从 `algebra/index.ts` /
 * `src/index.ts` / `internal.ts` 再导出。
 *
 * **契约③ `parseCallArgs` 快路径分派表（定型；Bug 430 的修法在此）**：
 *   `NumericLiteral` / `Unary(-)` / `ObjectExpression` / `ArrayExpression` /
 *   `StringLiteral` / `NullLiteral` / **`BooleanLiteral`（430 新增）** /
 *   `Identifier` / `MemberExpression` / `SpreadElement` / `CallExpression` /
 *   兜底 —— 实现在 `scan/literal-args.ts`。
 *
 * **契约④ `derefConstraint` 通路**：`literal-shapes.ts` 经
 * `../constraint.ts` 相对 import 拿到 `derefConstraint`（Bug 439 用）。
 *
 * **契约⑤ 零实参早退落点**：两处 `absArgs.length === 0` 早退在**薄壳**
 * `scan-literal-calls.ts` 的 `checkOneCall` / `checkExternalCall`。
 *
 * ── 本模块的公开（内部模块级）签名 ────────────────────────────────────────
 *   - `isExactUndef(a: Abs): boolean`
 *   - `nullishKindOf(a: Abs): "null" | "undefined" | undefined`
 *   - `predEqLiteral(p: Pred): number | string | boolean | bigint | undefined`
 *   - `predEqNullish(p: Pred): { value: null | undefined } | undefined`
 *   - `judgeLiteralPred(p: Pred, arg: Abs, argLen: number | undefined): boolean | undefined`
 *
 * ── 族 11 / S1 落地的口径（本片：429 / 431 / 1020）──────────────────────────
 *
 * **口径① 字面量同一性 = `===` + NaN 特例**（`sameLiteral`）：与 S3 的
 * `domain-membership.ts` 同口径（915 修完后字段/元素面不再用 `Object.is`）
 * ⇒ 标量面与字段/元素面不再两套。⚠ **不是** `Object.is`（那会把 `0` 与
 * `-0` 判成不同 ⇒ `-0` 的既有放行变报红）。
 *
 * **口径② null / undefined 分档**：`null` 与 `undefined` 是**两个值域**
 * ——`predEqNullish`（契约端）+ `nullishKindOf` / `isExactUndef`（实参端）。
 *
 * **口径③ `typeof`（`ptypeof`）谓词可判定**：`union(number(), string())`
 * 的成员实例化成 `or(typeof(x,"number"), typeof(x,"string"))` ⇒ 消费侧
 * 必须能判 `typeof` 原子，否则整条 union 契约零义务（431）。
 */

import { litValue } from "../abs.ts";
import type { Abs } from "../abs.ts";
import type { LiteralValue } from "../term.ts";
import type { Pred, TypeofName } from "../pred.ts";
import { TYPEOF_NAMES } from "../pred.ts";

/**
 * 确定 undefined / null 字面量（term lit；区别于「无 lit」的 unknown）。
 *
 * ⚠ **null 与 undefined 仍是同一档**（消费侧只问「是不是 nullish」）：
 *   - `checkReqs` 的 typeof 通道：nullish 实参的 prim 类型回落成 "undefined"
 *     ⇒ `number()` 契约对 `f(null)` **仍报违例**（null ⊭ number）；
 *   - `checkReqs` 的早退臂：nullish 实参对 `gt/ge/lt/le/eq/or` 一律不满足；
 *   - `checkShapeReqs` 的 array 通道：nullish 实参报「array at x」。
 * ⇒ **只认 undefined 会同时打穿这三条**（`number()`+null / `array()`+null
 * 变假绿 ⇒ 引入新的假绿，比 429 的假红更糟）。
 * ⇒ **值域分档**（null 与 undefined 是两个域）走 `nullishKindOf` /
 * `predEqNullish`，**不动本函数的「nullish 一档」语义**。
 */
export function isExactUndef(a: Abs): boolean {
  return (
    a.term?.op === "lit" &&
    ((a.term.value as unknown) === undefined || (a.term.value as unknown) === null)
  );
}

/**
 * 实参的 nullish 身份（Bug 965）：`null` / `undefined` / 非 nullish。
 *
 * `isExactUndef` 把 null 与 undefined 合成**一档**（消费侧只问「是不是
 * nullish」）——判**值域**时必须分档：`lit(null)` 契约只收 null，
 * `lit(undefined)` 契约只收 undefined，两者是不同的域。
 */
export function nullishKindOf(a: Abs): "null" | "undefined" | undefined {
  if (a.term?.op !== "lit") return undefined;
  if (a.term.value === null) return "null";
  if (a.term.value === undefined) return "undefined";
  return undefined;
}

/**
 * eq(var, lit) / eq(lit, var) 的标量字面量端；非该形态 → undefined。
 *
 * **bigint**（Bug 1020）：`lit(1n)` 的字面量端此前取不到值（`typeof 1n ===
 * "bigint"` 不在 number/string/boolean 域内）⇒ 该 `eq` 原子**永远不可判定**
 * ⇒ `lit(1n)` 契约在实参位是**恒真契约**（零义务 ⇒ `k(2)` 假绿）。
 * ⚠ 返回值里的 `undefined` 是「非该形态」哨兵 ⇒ **nullish 字面量端不走这里**
 * （走 `predEqNullish` 的 tagged 形态）。
 */
export function predEqLiteral(p: Pred): number | string | boolean | bigint | undefined {
  if (p.op !== "eq") return undefined;
  const v =
    p.a.op === "var" && p.b.op === "lit"
      ? p.b.value
      : p.b.op === "var" && p.a.op === "lit"
        ? p.a.value
        : undefined;
  return typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
    ? v
    : undefined;
}

/**
 * eq(var, lit null/undefined) 的 nullish 字面量端（Bug 965）；非该形态 → undefined。
 *
 * 用 tagged 形态返回：`undefined` 既是「字面量值 undefined」又是「非该形态」
 * 的哨兵，裸值表达不了 ⇒ 装进对象里区分。
 */
export function predEqNullish(p: Pred): { value: null | undefined } | undefined {
  if (p.op !== "eq") return undefined;
  let lit: LiteralValue;
  if (p.a.op === "var" && p.b.op === "lit") lit = p.b.value;
  else if (p.b.op === "var" && p.a.op === "lit") lit = p.a.value;
  else return undefined;
  if (lit === null || lit === undefined) return { value: lit };
  return undefined;
}

/**
 * 字面量同一性：`===` + NaN 特例（族 11 跨片口径①；S3 的
 * `domain-membership.ts` 同步改成同口径 ⇒ 标量面与字段/元素面不再两套）。
 *
 * ⚠ **不是** `Object.is`：SameValue 把 `0` 与 `-0` 判成不同，而执法面历来
 * 用 `===`（`-0 === 0` 为真 ⇒ `lit(-0)` 满足 `lit(0)`）⇒ 换成 Object.is 会
 * 让 `-0` 的既有放行变成报红。
 * NaN 特例：`===` 对 NaN 恒 false，但 `lit(NaN)` 与 `lit(NaN)` 是同一字面量
 * （否则 `lit(NaN)` 契约对自己的字面量报红 —— 434 的假红同款）。
 */
function sameLiteral(a: LiteralValue, b: LiteralValue): boolean {
  if (a === b) return true;
  return (
    typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)
  );
}

/**
 * 实参的 JS `typeof` 名（`TypeofName` 域）；不可判定 → undefined。
 *
 * 与 `checkReqs` 的 typeof 通道同域（prim / obj / arr / tuple / fn），
 * 另加 **nullish 分档**：`null` → "object"（JS `typeof null === "object"`）、
 * `undefined` → "undefined"。brand 拆壳取内层（品牌值仍是其内层类型）。
 */
function typeofNameOf(arg: Abs): TypeofName | undefined {
  const shape = arg.shape;
  if (shape.k === "brand") return typeofNameOf(shape.shape);
  if (shape.k === "prim") {
    return TYPEOF_NAMES.includes(shape.type) ? shape.type : undefined;
  }
  if (shape.k === "obj" || shape.k === "arr" || shape.k === "tuple") return "object";
  if (shape.k === "fn") return "function";
  const nk = nullishKindOf(arg);
  if (nk === "null") return "object";
  if (nk === "undefined") return "undefined";
  return undefined;
}

/**
 * 字面量可判定的原子谓词 → true/false；不可判定（非字面量端 / 非
 * number 值上的数值界）→ undefined。or 分支聚合用：任一 true 即过，
 * 全可判定且全 false 才报，含 undefined 不猜。
 *
 * `arg`：被检实参的 Abs（**不是**裸字面量值）——`lv` 由它内部派生。
 * 传 Abs 而不是裸值，是为了让消费侧能判「**类型**级」谓词
 * （`ptypeof(x, "number")` 之类的原语谓词需要实参的 prim 形状，
 * 光有字面量值判不出来）。
 *
 * `argLen`：length 通道的实参长度（字符串字数 / 数组元素个数；不可判 ⇒
 * undefined）——Bug 922 起长度界不再只对字符串求值。
 *
 * ── 族 11 / S1 的三处补齐 ────────────────────────────────────────────────
 * ① **nullish eq 原子可判定**（429）：`union(number().gt(0), lit(null))`
 *    实例化成 `or(gt(x,0), eq(x,null))`；此前 `eq(x,null)` 不可判定 ⇒
 *    or 聚合臂的 `unknown` 抑制 ⇒ **整条 union 契约零义务**（越界实参全放行）。
 *    现在按 `predEqNullish`（契约端）+ 实参的精确字面量（实参端）分档判定。
 * ② **`typeof`（`ptypeof`）原子可判定**（431）：`union(number(), string())`
 *    实例化成 `or(typeof(x,"number"), typeof(x,"string"))`；此前 `typeof`
 *    原子不可判定 ⇒ 同样被 `unknown` 抑制 ⇒ 整条 union 契约零义务。
 * ③ **bigint 字面量可判定**（1020）：`lit(1n)` 的 eq 原子此前取不到字面量端
 *    ⇒ 该契约在实参位是**恒真契约**（`k(2)` 假绿）。
 */
export function judgeLiteralPred(
  p: Pred,
  arg: Abs,
  argLen: number | undefined,
): boolean | undefined {
  const lvR = litValue(arg);
  const lvRaw = lvR.ok ? lvR.value : undefined;
  // 标量字面量域（number / string / boolean / bigint）——nullish 走 nullish 分档
  const lv =
    typeof lvRaw === "number" ||
    typeof lvRaw === "string" ||
    typeof lvRaw === "boolean" ||
    typeof lvRaw === "bigint"
      ? lvRaw
      : undefined;
  if (p.op === "eq") {
    // nullish 字面量端（lit(null) / lit(undefined)）：契约端用 tagged 形态取，
    // 实参端用**精确字面量**比（null 与 undefined 是两个域，`===` 天然区分）。
    const nv = predEqNullish(p);
    if (nv !== undefined) {
      // 实参不是精确字面量 ⇒ 判不了（不猜）
      if (!lvR.ok) return undefined;
      return sameLiteral(lvRaw, nv.value);
    }
    const v = predEqLiteral(p);
    if (v === undefined) return undefined;
    // 实参不是精确字面量 ⇒ 判不了（不猜）
    if (!lvR.ok) return undefined;
    return sameLiteral(lvRaw, v);
  }
  // typeof 原子（`ptypeof` 构造器产物）：union 的 prim 成员实例化成它。
  if (p.op === "typeof") {
    if (p.t.op !== "var") return undefined;
    const actual = typeofNameOf(arg);
    if (actual === undefined) return undefined;
    return actual === p.type;
  }
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") {
    return undefined;
  }
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
  const n = p.b.value;
  if (p.a.op === "app" && p.a.fn === "length") {
    if (argLen === undefined) return undefined;
    if (p.op === "gt") return argLen > n;
    if (p.op === "ge") return argLen >= n;
    if (p.op === "lt") return argLen < n;
    return argLen <= n;
  }
  if (typeof lv !== "number") return undefined;
  if (p.op === "gt") return lv > n;
  if (p.op === "ge") return lv >= n;
  if (p.op === "lt") return lv < n;
  return lv <= n;
}
