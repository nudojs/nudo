/**
 * L2 门禁配置的**配置面解析**（`package.json#nudo.check`）——单源 re-export。
 *
 * ⚠ 历史（BUG-110）：service 的 `checkConfig` 只认**严格 `string[]`** ⇒
 * 配置写成 `"TypeError"`（裸字符串）或 `["TypeError,RangeError"]`（数组元素
 * 内含逗号）时被**静默丢成空表** ⇒ IDE 仍报 `nudo:entry-may-throw`（假红），
 * 而 CLI 认这两种写法 ⇒ 同一份 package.json 两面口径分裂。本包曾因依赖图
 * 约束（lsp 不反向依赖产品包 nudojs）按「同语义镜像」自留一份手抄实现，
 * 与 CLI / vite-plugin 三面各一份 ⇒ 漏改任何一份口径就再分裂。
 *
 * 语义实现现已下沉 `@nudojs/service`（`service/src/gate-config.ts`，三面共享
 * 同一份：裸字符串 / 字符串数组都接受；数组元素内部也按逗号切分；trim 后
 * 丢空；非字符串元素忽略；全空 ⇒ `undefined`）。本文件只保住
 * `./gate-config.ts` 的既有 import 路径，消费方零改动。
 */
export { configIgnoreThrows, parseIgnoreThrows } from "@nudojs/service";
