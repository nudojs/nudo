# packages/vscode/src/__tests__/vscode-contract-emit-palette.test.ts

模块套件：6 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"面板路径（不传参）：交互式选择后进入 dry-run 预览（三步的第一步）"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
"面板路径：用户不确认 ⇒ 不写盘（门禁第二步）"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
"面板路径：用户确认 ⇒ 写盘请求照发（门禁第三步）"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
"dry-run 失败（isError）⇒ 不提供写盘、不发写盘请求"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
"CodeLens 路径（带 functionName）：不弹交互式选择，直接 dry-run"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
"文件里没有可固化目标 ⇒ 提示且不发请求"	"`nudo.contract.emit` 的处理器把 `functionName` 设为**必填** ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上 **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的 `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。 修法：面板路径下 `functionName"	没测该层	keep	keep	—
```
