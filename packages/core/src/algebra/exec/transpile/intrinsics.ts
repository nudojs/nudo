/**
 * 宿主内建标识符名单：Identifier 发射判据。
 *
 * 这三个名字是宿主全局，但**用户可以合法遮蔽**（`const undefined = 5`、
 * 函数形参名 `undefined`、`const NaN = 5`）。转译器按**本单元遮蔽判定**
 * （opts.shadowedIntrinsics，见 helpers.ts 的 shadowedIntrinsicsOf）分态：
 * - 未遮蔽 → 字面量精确折叠（`void 0` / `0/0` / `1/0`），产物与旧版逐字节
 *   一致，且 `0 === NaN` 等比较保留字面量身份；
 * - 已遮蔽 → 标识符读点发射标识符本身，由 JS 词法绑定决定（外层 `$absVal`
 *   把遮蔽绑定的 Abs 原样返回；见 expr/atom.ts 的 Identifier 臂）。
 *
 * env 注入是另一条通道：run.ts 的 env-skip 名单 = 本文件
 * HOST_INTRINSIC_NAMES ∪ NAMESPACE_GLOBALS 名字（见 run.ts 的
 * getEnvShadowSkipGlobals，**派生**而非手工同步）。跳过这三个名字避免模块级
 * `let <name> = __nudoEnv[...]` 遮蔽宿主全局（NaN/Infinity 的 env 声明是
 * 抽象 number ⇒ 字面量身份丢失，`0 === NaN` 从恒 false 退化成 boolean）。
 * @nudo:mock 不走该 skip（Bug 274：mock 遮蔽宿主全局正是意图）——mock 名进
 * 转译选项的 shadowedIntrinsics，标识符读点按绑定语义解析，mock 值因此生效。
 */
export const HOST_INTRINSIC_NAMES = ["undefined", "NaN", "Infinity"] as const;
export type HostIntrinsicName = (typeof HOST_INTRINSIC_NAMES)[number];

export const HOST_INTRINSIC_SET: ReadonlySet<string> = new Set(HOST_INTRINSIC_NAMES);

/** 生成代码里的 undefined 值源——刻意避开标识符 `undefined` */
export const UNDEF_LIT = "$lit(void 0)";
