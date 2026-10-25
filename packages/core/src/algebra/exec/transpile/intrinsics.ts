/**
 * 宿主内建标识符名单：Identifier 发射判据 + env/mock 注入 skip 同源。
 *
 * 这三个名字是宿主全局，但**用户可以合法遮蔽**（`const undefined = 5`、
 * 函数形参名 `undefined`、`const NaN = 5`）。转译器按**本单元遮蔽判定**
 * （opts.shadowedIntrinsics，见 helpers.ts 的 shadowedIntrinsicsOf）分态：
 * - 未遮蔽 → 字面量精确折叠（`void 0` / `0/0` / `1/0`），产物与旧版逐字节
 *   一致，且 `0 === NaN` 等比较保留字面量身份；
 * - 已遮蔽 → 标识符读点发射标识符本身，由 JS 词法绑定决定（外层 `$absVal`
 *   把遮蔽绑定的 Abs 原样返回；见 expr/atom.ts 的 Identifier 臂）。
 *
 * env 注入是另一条通道：run.ts 的 ENV_SHADOW_SKIP（= 本文件
 * ENV_SHADOW_SKIP_GLOBALS）跳过这三个名字，避免模块级
 * `let <name> = __nudoEnv[...]` 遮蔽宿主全局（NaN/Infinity 的 env 声明是
 * 抽象 number ⇒ 字面量身份丢失，`0 === NaN` 从恒 false 退化成 boolean）。
 * @nudo:mock 不走该 skip（Bug 274：mock 遮蔽宿主全局正是意图）——mock 名进
 * 转译选项的 shadowedIntrinsics，标识符读点按绑定语义解析，mock 值因此生效。
 */
export const HOST_INTRINSIC_NAMES = ["undefined", "NaN", "Infinity"] as const;
export type HostIntrinsicName = (typeof HOST_INTRINSIC_NAMES)[number];

export const HOST_INTRINSIC_SET: ReadonlySet<string> = new Set(HOST_INTRINSIC_NAMES);


/**
 * env 注入跳过（不遮蔽宿主内建）：
 * - undefined/NaN/Infinity：标识符读点按 JS 绑定语义解析（未遮蔽 → 宿主
 *   裸值经 $absVal 收成 Abs，遮蔽绑定生效）。env 注入仍是模块级
 *   `let <name> = __nudoEnv[...]` 遮蔽：NaN/Infinity 被 env 声明成抽象
 *   number ⇒ 字面量身份丢失（`0 === NaN` 退化 boolean），故跳过。
 * - Math/Number/JSON/Object/Array/String/Date/Promise/BigInt/Reflect/Symbol：这些
 *   名字在 namespaceNameOf 里按宿主对象身份路由到 Abs builtin 表（数学/集合/
 *   date 等），
 *   env 若注入 `const Math = …` 会把 $get/$invoke 接收者从宿主对象替换成 Abs
 *   表项，路由失效 → 区间透传/语义精度回退（issue #87）。跳过后接收者回到
 *   宿主身份，namespaceNameOf 照常路由，等价于 env 关。
 * console/document/process 等未进 namespaceNameOf 表的暂不跳过，避免路由
 * 覆盖不到让用户代码退化 unknown（parity 门钉住名单不漂移）。
 */
export const ENV_SHADOW_SKIP_GLOBALS: ReadonlySet<string> = new Set([
  ...HOST_INTRINSIC_NAMES,
  "Math",
  "Number",
  "JSON",
  "Object",
  "Array",
  "String",
  "Date",
  "Promise",
  "BigInt",
  // Bug 19/43：进 NAMESPACE_GLOBALS 路由表（Reflect.*/Symbol.for 静态分派）
  "Reflect",
  "Symbol",
  // Bug 24：进路由表（URL.canParse 静态分派；new URL 走 clsName 派发不受影响）
  // Bug 322 补记 skip 的**连带后果**：skip 只保住了「宿主身份路由不被 env
  // 遮蔽」，却让 env 侧更完整的 **URL 实例模型**（packages/env/src/web.ts
  // 的 `searchParams: URLSearchParams`）**永远到不了构造面**——`new URL(...)`
  // 走 core 的 makeUrlAbs（exec/class/declare.ts），不看 env 注入 ⇒ env 那
  // 份模型对构造路径不可达。构造面的实例槽（searchParams 等）由 core 侧
  // 补齐（declare.ts 的 withUrlSearchParamsSlot）；env 侧建模仍需主 agent
  // 裁决合并（不擅自解 skip——解 skip 会破 issue #87 的身份路由）。
  "URL",
  // Bug 56：进路由表（X.prototype.<method> 值读借用调用）——parity 门要求
  // 路由名必须同步跳过 env 注入，否则 `const Map = …` 遮蔽宿主身份路由
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Boolean",
  "RegExp",
  "Error",
  // Bug 68：Error 家族七子类进路由表（.prototype 身份读 / 家族派发）——
  // parity 门要求路由名同步 skip，防 env 注入遮蔽宿主身份路由
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
  // Bug 44：进路由表（Intl.NumberFormat/DateTimeFormat 构造器值 + typeof
  // Intl 折 object + 成员投影）——skip 防 env 注入遮蔽宿主身份路由
  "Intl",
  // Bug 27：TypedArray 全家进路由表（from/of 静态面校验 + 常量成员投影）
  // ——skip 防 env 注入遮蔽宿主身份路由（parity 门钉住）
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  // Bug 40：二进制/弱引用构造器进路由表（.prototype 成员读派发）——skip
  // 防 env 注入遮蔽宿主身份路由（parity 门钉住）
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "WeakRef",
  "FinalizationRegistry",
]);

/** 生成代码里的 undefined 值源——刻意避开标识符 `undefined` */
export const UNDEF_LIT = "$lit(void 0)";
