/**
 * service 测试 check 面共享 harness（对齐 core `__tests__/nudo-constraints.ts` 口径）：
 * 结构化参数签名——任何 `issues: { code, fn? }[]` 形状的 checkSource 结果均可传，
 * 不绑定各文件本地 check 包装的返回类型。
 */

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选）——去重自 env-ctor-may-throw / env-super-error-slots 私有副本 */
export function l2Count(
  r: { issues: { code: string; fn?: string }[] },
  fn?: string,
): number {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  ).length;
}
