---
"@nudojs/harvester": patch
"nudojs": patch
---

族 27 收口接线：让**三个产物面**（内存收割面 / 磁盘缓存面 / 落盘源码面）与
**两个产物面**（收割面 / 草稿面）在同一份 `.d.ts` 上给出**同一个类型**。

**磁盘 ABI v8 → v9 → v10** —— `HARVEST_DISK_ABI` 随收割语义抬版本。不抬则
用户本地 `~/.cache/nudo/deps/` 里的旧收割产物会继续命中 ⇒ CLI **看不到本轮
修复**（实测：同一夹具，旧缓存 ⇒ `useDefault(xs: any) => unknown`）。
v10 覆盖收口时又改的三处语义：`this` 形参不再进收割签名（Bug 794）、
`declare class` 进入接口成员表并带 `ctor` facet（Bug 796 / 826）、顶层
`declare namespace` 的运行时成员收进命名空间自有记录（Bug 793）。

**磁盘投影补 facet** —— `HarvestSig` 此前只投影 `params` / `returns`，把
`obj` 的索引签名与开放标志、`tuple` 的 rest、`fn` 的 `ctor` 与静态槽**全部
丢掉** ⇒ 缓存往返把「开放对象 + 值域」抹成闭合空对象（成员读 undefined ⇒
定抛）、把「构造器」抹成普通 fn（`new` 落「可构造性未知」⇒ 假红）、把类型
字面量的具名成员抹掉。`absToHarvestSig` 投影 + `harvestSigToAbs` 还原两侧
同时补齐。

**磁盘投影补条件元数据** —— `fn` 形态加 `inferFrom` / `condFallback`：条件
类型判不出时的绑定线索与假支此前不投影 ⇒ 缓存命中后条件元数据丢失 ⇒
**同一份 `.d.ts`，冷缓存与热缓存给出不同类型**（实测：改前冷 ⇒ `callCond()`
返回 `0`，热 ⇒ `any`；改后冷 / 热完全一致）。

**落盘源码面补 `ctor` / 静态槽** —— `emitAbs` 的 `fn` 分支此前只发
`relationFn([...], ret, { conf: "exact" })`，把 facet 全丢 ⇒ 走落盘 env 模块
时 `new X()` 判「可构造性未知」。用 IIFE 在 `relationFn` 之后补 facet（**不改
core 冻结面**）⇒ 三路径同型。

**草稿面 `this` 形参跳过** —— `dts-contract-draft.ts` 的参数收集此前把
`this` 写成必填实参位 ⇒ 草稿元数 +1（第一个真实实参被绑到 `this` 槽）。
判据同收割面。

**草稿面接口 heritage 展开** —— `extends` 基接口的成员进草稿（带环保护）。

**CLI 汇总行接 `droppedDirs`** —— `nudo contract --from-dts <目录>` 的目录
模式只取 `dtsPathToContractDraft` 的 `files`、**丢掉它的 stats** ⇒
「遍历不到的目录」不出现在汇总行 ⇒ 汇总行报「0 skipped」而实际丢了东西。
现在并进 `skipped`。
