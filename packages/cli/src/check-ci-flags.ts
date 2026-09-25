/**
 * check 缓存 / CI 注解决策（纯）。
 */

/** GitHub Actions 行内注解开关：显式 flag 压过环境变量 */
export function shouldEmitGha(
  optsGha: boolean | undefined,
  envGha: string | undefined,
): boolean {
  return optsGha === true || (optsGha !== false && envGha === "true");
}

/** 磁盘缓存可用性：enabled 且无截断/缺依赖/外部调用注入 */
export function shouldUseDiskCache(flags: {
  diskEnabled: boolean;
  hasFrom: boolean;
  depTruncated: boolean;
  hasBareMiss: boolean;
}): boolean {
  return (
    flags.diskEnabled &&
    !flags.hasFrom &&
    !flags.depTruncated &&
    !flags.hasBareMiss
  );
}

/** 缓存键仅在非 verbose / 非 abs 观察面时计算 */
export function shouldComputeCacheKey(opts: {
  useDisk: boolean;
  verbose?: boolean;
  abs?: boolean;
}): boolean {
  return opts.useDisk && !opts.verbose && !opts.abs;
}

/** 诊断 → 文档深链仅终端面；--json 契约不变。abs 成功时也不打 */
export function shouldPrintDocsLinks(opts: {
  json?: boolean;
  abs?: boolean;
  issueCount: number;
  reportOk: boolean;
}): boolean {
  return !opts.json && opts.issueCount > 0 && (!opts.abs || !opts.reportOk);
}
