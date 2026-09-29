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
