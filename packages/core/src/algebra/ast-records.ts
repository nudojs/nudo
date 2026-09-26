/**
 * Abs 域记录类型面（ast-eval 执行器删除后保留）。
 * 运行时记录由 B 通道（BCallRecord/$assignRecord）产生；此处的类型是
 * checkSource drift / 结构赋值诊断的共享形状，仍被 check.ts 等消费。
 */
import type { Abs } from "./abs.ts";

/** Abs 域调用记录（B 通道 BCallRecord 的同形投影） */
export type AbsCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

/** Abs 域赋值记录（B 通道 $assignRecord 的同形投影） */
export type AbsAssignRecord = {
  name: string;
  prev?: Abs;
  next: Abs;
  line?: number;
  column?: number;
  /** 分支/循环体内发生：可变绑定在路径上取并集是合法 JS，不参与结构检查 */
  conditional?: boolean;
};
