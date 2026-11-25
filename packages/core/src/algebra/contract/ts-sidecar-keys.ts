/**
 * 剥除 pass 留在 AST 节点上的**类型旁路键**（单源）。
 *
 * 旁路是**不可枚举**属性：`Object.keys` / `for…in` / 结构等价断言都看不见。
 * 写方（`strip-types.ts` 的剥除 pass）与读方（发射面 `nudoTypeNode` /
 * `nudoReturnTypeNode` 旁路）共用这一张表；任何对节点做**深拷贝**的地方
 * （`class-emit.ts` 的 scopePrivateNames）必须按 `TS_SIDECAR_KEYS` 显式搬运，
 * 否则类字段 / 返回注解在副本里丢失（BUG-414）。
 *
 * 零 import 的叶子：strip-types（core/src 根）与 algebra/exec 都能直接 import，
 * 不成环。
 */
export const TS_SIDECAR_KEY = {
  typeText: "nudoTypeText",
  typeNode: "nudoTypeNode",
  returnTypeText: "nudoReturnTypeText",
  returnTypeNode: "nudoReturnTypeNode",
  typeArguments: "nudoTypeArguments",
  typeArgumentNodes: "nudoTypeArgumentNodes",
} as const;

/** 全部旁路键名（深拷贝 / 遍历搬运用；顺序即写入面的声明顺序）。 */
export const TS_SIDECAR_KEYS: readonly string[] = Object.freeze([
  TS_SIDECAR_KEY.typeText,
  TS_SIDECAR_KEY.typeNode,
  TS_SIDECAR_KEY.returnTypeText,
  TS_SIDECAR_KEY.returnTypeNode,
  TS_SIDECAR_KEY.typeArguments,
  TS_SIDECAR_KEY.typeArgumentNodes,
]);
