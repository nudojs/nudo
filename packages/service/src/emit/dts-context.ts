/**
 * dts 类型投影的运行时上下文与唯一渲染入口。
 *
 * 此前 5 个可变全局（brandScope / readonly / symbol 覆盖 / user symbol 队列 /
 * object fn 覆盖）分散在 generator 里；现在收成一份快照，且类 / 模块 / 值
 * 发射器只通过参数或显式注入的渲染函数消费，不再直接读全局。
 */
import type { Abs } from "@nudojs/core";
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
import {
  dtsTypeOfAbs,
  renderDtsType,
  type DtsBrandScope,
  type DtsDrop,
} from "./dts-type.ts";

export type DtsProjectionContext = {
  readonlyValues: boolean;
  brandScope?: DtsBrandScope;
  symbolReturnOverrides?: ReadonlyMap<string, string>;
  userSymbolKeys?: readonly string[];
  objectFnReturnOverrides?: ReadonlyMap<string, string>;
  onDrop?: (drop: DtsDrop) => void;
};

let currentDtsContext: DtsProjectionContext = { readonlyValues: false };

/** 在给定投影上下文下渲染；嵌套时按 patch 合并并恢复。 */
export function withDtsContext<T>(
  patch: Partial<DtsProjectionContext>,
  fn: () => T,
): T {
  const prev = currentDtsContext;
  currentDtsContext = { ...prev, ...patch };
  try {
    return fn();
  } finally {
    currentDtsContext = prev;
  }
}

export function pushDrop(sink: DtsDrop[], drop: DtsDrop): void {
  if (sink.some((d) => d.key === drop.key && d.reason === drop.reason)) return;
  sink.push(drop);
}

/** 无法表达成员的可诊断台账（产物里是注释，不影响 TS 语法）。 */
export function dropLedgerLines(drops: readonly DtsDrop[]): string[] {
  return drops.map(
    (d) =>
      `// nudo:dropped-type-member ${d.key} — symbol key has no source name (cannot be expressed in .d.ts)`,
  );
}

/** dts 类型文本：唯一的 IR 渲染入口。 */
export function absToTSTypeIr(a: Abs, typeVars?: Map<string, string>): string {
  const ctx = currentDtsContext;
  const t = dtsTypeOfAbs(a, {
    readonlyValues: ctx.readonlyValues,
    ...(ctx.brandScope === undefined ? {} : { brandScope: ctx.brandScope }),
    runtimeGlobalCtor: isRuntimeGlobalCtorName,
    ...(typeVars === undefined ? {} : { typeVars }),
    ...(ctx.objectFnReturnOverrides === undefined
      ? {}
      : { objectFnReturnOverrides: ctx.objectFnReturnOverrides }),
    ...(ctx.symbolReturnOverrides === undefined
      ? {}
      : { symbolReturnOverrides: ctx.symbolReturnOverrides }),
    ...(ctx.userSymbolKeys === undefined
      ? {}
      : { userSymbolKeys: [...ctx.userSymbolKeys] }),
    ...(ctx.onDrop === undefined ? {} : { onDrop: ctx.onDrop }),
  });
  return renderDtsType(t);
}
