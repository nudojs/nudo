/**
 * Object.assign 语义（运行时 `= Object.assign(target, ...src)` 展开）。
 *
 * 单一实现在 builtins/object/descriptor.ts 的 performObjectAssign——本文件
 * 只保留运行时入口名（invoke.ts 的 Object.assign 直接调用面）。second-class
 * 静态读面（`const g = Object.assign; g(t, s)` / `.call` / `.apply`）在
 * builtins/object/methods.ts 的 assign 臂调同一函数，引用语义（就地写、
 * 别名可见、语句位可见）由该实现保证。
 */
import type { Abs } from "../../abs.ts";
import { performObjectAssign } from "../../builtins/object/descriptor.ts";

export function runtimeAssignObject(args: Abs[]): Abs {
  return performObjectAssign(args);
}
