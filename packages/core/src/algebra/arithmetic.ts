/**
 * 算术核：单调性 + 常量折叠 + 约束传播。
 * 这是「类型即计算」的主武器——x>0 时 x+1 必须得到 >1。
 *
 * 拆分 facade：实现按域下沉 arithmetic/ 子目录——shared（跨域折叠
 * helper）/ coerce（brand 解箱 + 强转 may-throw + bigint 折叠）/ bounds
 * （numericBounds 区间 + isNonNaN）/ addsub / muldiv / cmp。依赖方向
 * shared/coerce/bounds（叶子）← addsub/muldiv/cmp ← 本 facade，单向无环。
 * 本文件只做显式具名 re-export，导出面与拆分前零漂移（public-api-freeze
 * 钉住）；实现改动进域模块，勿在此写函数体。arithmetic 无模块体加载期
 * 注册/setter（纯函数声明），经 facade 引用无 SSR 实例化序风险。
 */
export { builtinBrandToPrimitive } from "./arithmetic/coerce.ts";
export { add, sub } from "./arithmetic/addsub.ts";
export type { NumBounds } from "./arithmetic/bounds.ts";
export { numericBounds, isNonNaN } from "./arithmetic/bounds.ts";
export { mul, div, mod } from "./arithmetic/muldiv.ts";
export { cmp, trueConstraint, refineAbsForRelTrue, matchRelIdentLit, falseConstraint } from "./arithmetic/cmp.ts";
