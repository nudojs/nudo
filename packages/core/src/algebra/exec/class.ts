/**
 * 求值引擎 class：brand 实例 + ctor/method 闭包 + 继承链。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 *
 * 按域拆分（barrel 保持原导入面不变）：
 * - declare     类声明/注册/构造（$class/$new/$staticInit + registry 辅助）
 * - assign      Object.assign 语义（runtimeAssignObject/assignArrayTarget）
 * - invoke      调用派发总入口（$invoke/$invokeInner + protoMethod 注册）
 * - invoke-arr  数组方法族模拟（invokeArrMethod）
 * - super       super 家族（$super/$invokeSuper/$getSuper/静态 super）
 * - this-member this/可选链/静态成员读写（$thisGet/$optionalGet/$setKey）
 */
export {
  $class,
  $new,
  $staticInit,
} from "./class/declare.ts";
export {
  $super,
  $invokeSuper,
  $getSuper,
  $setSuper,
  $invokeSuperKey,
  $invokeSuperObj,
  $getSuperObj,
  $setSuperObj,
  $staticSuperInvoke,
  $setSuperStatic,
} from "./class/super.ts";
export {
  $invoke,
  refineFnReturnType,
} from "./class/invoke.ts";
export {
  $thisGet,
  $thisSet,
  $orDefault,
  $optionalGet,
  $optionalInvoke,
  $staticInvoke,
  $setKey,
} from "./class/this-member.ts";
export type { EvalClassSpec } from "./class-registry.ts";
export { registerEvalClass, getEvalClass, clearBClasses } from "./class-registry.ts";
export { regexParts, regexExecWithState, execRegexBrand, $reStateCall, stringRegexMethod } from "./class-regex.ts";
