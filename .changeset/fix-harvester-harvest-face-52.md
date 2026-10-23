---
"@nudojs/harvester": patch
---

族 52 修复（片 W2）：harvester **收割面**的 7 条残留 —— ①**非限定**类型引用按「引用点所在命名空间」解析（`A.Opts` 与 `B.Opts` 不再互相并入；792 残留）；②`extends` 的**基接口**按基声明分别代入类型实参（`interface D extends Base<number>` ⇒ 基成员 `v` 是 `number`，不再是 α）；③条件类型按**绑定实参**求值真支（嵌套条件类型给出精确的 `"s"` / `"n"` / `"x"`，不再给并集）；④泛型实例化顺序反转（成员在**类型实参**的作用域里映射 ⇒ `Box<Promise<string>>` 的 `payload` 是 `string`，不再是 α）；⑤**模块作用域**的命名空间不再摊平进模块记录（`declare module "x" { namespace Y { … } }` ⇒ `import { bar } from "x"` 不再错误解析成功，与 TS 的 TS2305 同口径；`export = ns` 的模块导出面仍摊平 ⇒ @types/node 的 `node:path` 等真实包零回归）；⑥「类型未建模」进 `stats.degraded`（**可选**字段，降级 ≠ 丢了；没有降级时 `stats` 形状逐字不变）；⑦**匿名**默认导出（`export default function (): void;` / `export default class { … }`）不再被丢掉 ⇒ 模块的 `default` 导出在，不再计入 `skipped`。

**磁盘 ABI v10 → v11** —— `HARVEST_DISK_ABI` 随收割语义抬版本（①②③④⑦ 任一条都会让
旧缓存的物化结果与新收割器不一致 ⇒ 旧缓存必须 miss，否则用户本地
`~/.cache/nudo/deps/` 里的旧收割产物会继续命中 ⇒ CLI 看不到本轮修复）。
