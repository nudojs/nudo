# packages/vscode/src/__tests__/vscode-select-case-palette.test.ts

模块套件：6 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"面板路径（不传参）：提示缺参，不把 undefined 发给服务端"	"VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:false, error, isError:true }`）⇒ 本族**只"	没测该层	keep	keep	—
"面板路径（不传参）：不留 junk 的 undefined 档表（画面无变化）"	"乐观高亮只在参数齐全时才会写档表 ⇒ 面板路径不再写 junk 条目。 VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:f"	没测该层	keep	keep	—
"缺 uri 时回落到活动编辑器（与兄弟命令同款）"	"VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:false, error, isError:true }`）⇒ 本族**只"	没测该层	keep	keep	—
"CodeLens 路径（4 参齐全）：请求照旧 + 乐观高亮"	"VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:false, error, isError:true }`）⇒ 本族**只"	没测该层	keep	keep	—
"服务端的结构化错误被显式呈现（result ≠ JSON-RPC error ⇒ catch 不触发）"	"VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:false, error, isError:true }`）⇒ 本族**只"	没测该层	keep	keep	—
"服务端拒绝时回滚乐观高亮（不留幽灵高亮）"	"VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」 （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种 ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个 `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。 ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误 `{ success:false, error, isError:true }`）⇒ 本族**只"	没测该层	keep	keep	—
```
