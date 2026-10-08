/**
 * 宿主内建标识符：转译折叠 + env/mock 注入 skip 同源。
 *
 * 这三个名字由转译器硬编码折叠成**无标识符**表达式（`void 0` / `0/0` / `1/0`），
 * 不读模块作用域绑定。env 全局若注入 `const undefined = …` 会遮蔽宿主内建，
 * 让产物里的裸标识符/`$lit(...)` 实参拿到 Abs——故注入侧必须 skip（见 run.ts）。
 */
export const HOST_INTRINSIC_NAMES = ["undefined", "NaN", "Infinity"] as const;
export type HostIntrinsicName = (typeof HOST_INTRINSIC_NAMES)[number];

export const HOST_INTRINSIC_SET: ReadonlySet<string> = new Set(HOST_INTRINSIC_NAMES);


/**
 * env 注入跳过（不遮蔽宿主内建）：
 * - undefined/NaN/Infinity：转译已硬编码折叠为无标识符源，注入无收益且危害已修
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
]);

/** 生成代码里的 undefined 值源——刻意避开标识符 `undefined` */
export const UNDEF_LIT = "$lit(void 0)";

/** 标识符 → `$lit(...)` 发射源；非内建 → undefined */
export function hostIntrinsicLit(name: string): string | undefined {
  switch (name) {
    case "undefined":
      return UNDEF_LIT;
    case "NaN":
      // `0/0` 无标识符依赖，宿主求值即 NaN
      return "$lit(0/0)";
    case "Infinity":
      return "$lit(1/0)";
    default:
      return undefined;
  }
}
