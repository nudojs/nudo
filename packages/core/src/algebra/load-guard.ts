/**
 * loadModule 读错误降级闸（Bug 499）。
 *
 * 口径与 service 侧 `guardedLoadModule`（packages/service/src/load-module.ts）
 * 对齐——core 不得依赖 service（依赖方向 service → core），故按**鸭子类型**
 * 读错误对象的 `code` / `path` / `message`：service 的 `ModuleReadError`
 * 正是这三个字段（`code` = errno 码，`path` = 候选路径，`message` = 读错原因）。
 *
 * 三态（不可再折叠成两态）：
 * - **ok**：loader 返回源码；
 * - **missing**：loader 返回 undefined（无此文件）——分析面按缺依赖处理，
 *   **不报错**（既有行为）；
 * - **unreadable**：loader **抛错**（EACCES / EIO / EMFILE / ESTALE…）——
 *   文件在，只是读不了。**不得穿透到调用方顶层**：一个不可读的依赖会把
 *   `nudo check` 整轮带走（stdout 0 字节、无任何报告）。
 *
 * 降级动作：读失败 ⇒ 该依赖按「不可用」处理（undefined）+ 上报一条
 * 结构化失败（路径 / errno / 原因），由调用方决定诊断码与严重级。
 *
 * **只降级 errno 级的读故障**（`code` 形如 `EACCES` / `EIO` / `EMFILE` /
 * `EREAD`…）：那是**环境**问题（文件在，读不了）⇒ 诊断化、门禁 fail-closed。
 * 其它异常（loader 内部错误、编程错误、宿主异常）**保持 fail-loud**（原样
 * 上抛）——宿主有自己的错误面（LSP 的 `Check error:` 脱敏面依赖它；CLI 顶层
 * 也会给出明确的失败信息），把它们一并吞掉会掩盖真实缺陷。
 */

/** 一次读失败的最小结构（与 service 的 ModuleReadError 字段同名同义） */
export type LoadReadFailure = {
  /** 出错路径（loader 报的候选路径；缺失时退回说明符） */
  path: string;
  /** errno 码（EACCES / EIO / EMFILE…） */
  code: string;
  /** 失败原因（原始 message） */
  message: string;
};

/** errno 码形态（Node fs 错误码：`EACCES` / `ENOENT` / `EMFILE` / …） */
const ERRNO_CODE = /^E[A-Z0-9_]+$/;

/**
 * 抛错 → 结构化读失败；**非 errno 级异常返回 undefined**（不是读故障，
 * 保持 fail-loud）。
 */
export function readFailureOf(e: unknown, fallbackPath: string): LoadReadFailure | undefined {
  const err = e as { code?: unknown; path?: unknown; message?: unknown } | undefined;
  const code = typeof err?.code === "string" ? err.code : undefined;
  if (!code || !ERRNO_CODE.test(code)) return undefined;
  return {
    path: typeof err?.path === "string" ? err.path : fallbackPath,
    code,
    message:
      typeof err?.message === "string"
        ? err.message
        : e instanceof Error
          ? e.message
          : String(e),
  };
}

/**
 * loader 容错包装：读失败（errno 级抛错）⇒ undefined（该依赖不可用）+
 * onFailure 回调。**非 errno 级异常原样上抛**（fail-loud，见文件头）。
 *
 * ENOENT 视为「无此文件」（miss）：按 undefined 返回，**不上报**——
 * 「文件刚好被删」的竞态不是读故障，不该在报告里留一条 error。
 */
export function guardLoadModule(
  load: (spec: string, fromFile: string) => string | undefined,
  onFailure?: (failure: LoadReadFailure) => void,
): (spec: string, fromFile: string) => string | undefined {
  return (spec, fromFile) => {
    try {
      return load(spec, fromFile);
    } catch (e) {
      const failure = readFailureOf(e, spec);
      if (!failure) throw e;
      if (failure.code === "ENOENT") return undefined;
      onFailure?.(failure);
      return undefined;
    }
  };
}
