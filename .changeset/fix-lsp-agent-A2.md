---
"@nudojs/lsp": minor
"@nudojs/service": minor
---

三个 contract 工具**新增**入参 `from?: string[]`（`--from` 等价通道），`@nudojs/service`
**新增**公开导出 `collectCallsiteRecords`（+ 类型 `CallsiteRecords`）⇒ 纯**增量**
（additive）⇒ minor。

fix(lsp,service): 族 25 A2 —— 契约面四条缺陷（762 / 765 / 766 / 994）

- **762** `nudo.contract.emit` 现在与 CLI `nudo contract --emit` **同序同口径**：
  先 `emitDerivedFromRoot`（root 驱动下行推导），再 `emitInterface`（本地侧车）。
  此前工具**从不**调派生步 ⇒ CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面
  永远不产生，且结果文本把「引擎没做的那一步」说成「name-clash」——误导性诊断。
  下游侧车的写盘边界与本地侧车同口径（必须落在 workspace roots 内）。
- **765** 源文件 open buffer 与磁盘文本不一致时**拒绝写盘**（可诊断错误：
  save or discard before emit）——此前只挡了侧车自己的脏 buffer，源文件的脏
  buffer 会把**未保存**的代码形状写进侧车，磁盘源码却一个字节没变。
- **766** emit 写盘边界改按**路径分量**判定逃逸（`..` 或 `..` + 分隔符），
  不再误杀 `..dotted.js` / `...triple.js` / `..cfg/x.js` 这类合法路径名；
  root 外的文件与指向 root 外的符号链接**仍然拒绝**。
- **994** 三个 contract 工具（`nudo/contract` / `nudo/contract.draft` /
  `nudo/contract.emit`）新增 `from?: string[]`（`--from` 等价通道）：跨文件
  调用点证据参与契约求解，接口面/草稿/落盘与 CLI `nudo contract --from` 同口径。
  证据采集下沉到 service：新增导出 `collectCallsiteRecords`（+ 类型
  `CallsiteRecords`）。
