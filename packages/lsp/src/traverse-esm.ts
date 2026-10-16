/**
 * @babel/traverse 的 ESM/CJS 双形态归一。
 * CJS 入口把可调用函数直接挂 module.exports（Node ESM 互操作下
 * default import 拿到函数本身）；@babel/traverse 8 的 ESM 构建则把它
 * 放在 default 槽（default import 拿到 `{ default: fn }` 包装）。
 * 运行期探测哪个形态可调用并返回，消费方不再各自手搓 interop。
 */
import traverse from "@babel/traverse";

export function traverseEsm(): typeof traverse {
  const mod = traverse as typeof traverse | { default: typeof traverse };
  return typeof mod === "function" ? mod : mod.default;
}
