/**
 * export — guard 产物面：`is<fn>Output` 类型守卫。
 *
 * 守卫消费调度器算好的**统一返回面**（契约面优先）：
 * - 有返回契约 ⇒ 守卫与 zod / standard / dts 三个面**同一口径**（Bug 599 /
 *   Bug 613）：契约域是用户申报的出口域，守卫按它收窄 ⇒ 同一次导出里两个面
 *   不会对同一个值给出相反裁决（改前：守卫取观测字面量 `data === 1`，而
 *   zod 面取契约域 `{ v: number }` ⇒ 契约允许的值被守卫判非法）。
 * - 无返回契约 ⇒ 回落**观测面**（`fn.combinedAbs`）：契约放宽的域不改变既有
 *   调用的返回值形态（否则 `data === 3` 这类合法调用会被判非法，Bug 511）。
 *
 * 裁剪：导出面闸门装在**循环入口**（`selection.ts` 的 `selectPublicFunctions`
 * ——四个产物面共用一道闸门，Bug 621 / Bug 628，安装点归 S3）⇒ 本模块收到
 * 的函数已是**导出面**的函数，不再自带闸门（避免两处安装）。
 */
import { generateGuardFunctionFromAbs } from "@nudojs/service/emit";
import type { Abs } from "@nudojs/core";

/**
 * guard 面的函数块：`\n// === <fn> Type Guards ===` 标题 + 守卫源码。
 *
 * 无返回面（`outputAbs` 缺省）⇒ 只出标题（不产守卫）。
 *
 * **去重集合**（族 17 · Bug 608 / Bug 623）：守卫名 `is<fn>Output` 经标识符
 * 清洗后可能撞名（`A.b` 与 `A_b` 清洗后同名；同一个类里两个同名方法也是
 * 同名）⇒ 同一份产物（stdout 流 / `--out` 的 guard 文件）里必须**逐个去重**
 * （第二个起加 `_2` 后缀），否则产物里出现两个同名 `export function` ⇒
 * TS2393 重复声明。
 *
 * `used` 由**调度器**按「一份产物」建一份并跨函数块共享（guard 块在 stdout
 * 流里同属一个模块作用域，在 `--out` 时同属一个文件 ⇒ 同一作用域）。
 */
export function guardFaceChunk(
  baseName: string,
  outputAbs: Abs | undefined,
  used?: Set<string>,
): string {
  const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
  if (outputAbs) {
    lines.push(generateGuardFunctionFromAbs(`is${baseName}Output`, outputAbs, used));
  }
  return lines.join("\n");
}
