/**
 * Date 构造 / Date.* / Date 实例方法（保守未建模）
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { numPrim, str } from "./shared.ts";

export function evalDateCtor(args: Abs[]): Abs {
  return abs(
    { k: "brand", name: "Date", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "path",
  );
}

export function evalDateStatic(name: string, _args: Abs[]): Abs | undefined {
  // Date.now() 非编译期常量：每次运行值都变，折叠成具体时间戳既不 sound 又
  // 让分析结果不确定（golden/memo 抖动）。返回 number（未知）。
  if (name === "now") return numPrim("path");
  return undefined;
}

export function evalDateMethod(name: string, _recv: Abs, _args: Abs[]): Abs | undefined {
  switch (name) {
    case "getTime":
    case "valueOf":
      return numPrim("path");
    case "toISOString":
    case "toString":
      return str("path");
    default:
      return undefined;
  }
}
