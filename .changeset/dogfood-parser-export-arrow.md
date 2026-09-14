---
"@nudojs/parser": minor
---

`getFunctionName` 对 `export const f = …`（ExportNamedDeclaration + VariableDeclaration）返回 `<anonymous>`——现在递归进入声明节点，导出箭头函数获得真实函数名，case 求值可达。
