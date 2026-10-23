---
"@nudojs/lsp": patch
---

fix(lsp): Extract to function 的插入点 / 语句切分 / 取名收口（族 23 片 C：Bug 732 / 734 / 736 / 740 / 742 / 971）

- **Bug 732**：`Extract to function` 不再把原函数的 `export` 关键字偷给新函数 ——
  插入点改用**语句起点**（`export` 的列）而不是 `function` 关键字的列 ⇒ 模块公开 API
  不再从 `['f']` 静默变成 `['extracted']`。
- **Bug 734**：被抽出的若是**赋值表达式**（`x = compute();`），调用点生成**赋值表达式**
  （`x = extracted(...)`）而不是硬编码的 `const x = ...` ⇒ 不再与外层 `let x` 重复声明
  （文件曾彻底不可解析）。原本就是声明时还原同种声明（`const` / `let` / `var`）。
- **Bug 736**：新函数只插在**语句位置** ⇒ 箭头初始化式 / 对象字面量方法 / class 方法
  三种宿主不再产出不可解析的文件。
- **Bug 740**：选区含 `break` / `continue` 时**拒绝**抽取（不再产出
  `SyntaxError: Illegal break statement`）；选区末条是 `return` 时**把返回值接回调用点**
  （`return extracted();`）⇒ 外层返回值不再被静默丢掉。
- **Bug 742**：顶层选区的插入点跳过文件前导区（hashbang / 指令 / 前导注释）⇒ 新函数不再
  落到 `#!/usr/bin/env node` 之前（文件曾整体不可解析）。
- **Bug 971**：新函数名做**占用检查**（在 `extract-function.ts` 内部，调用方零改动）⇒
  撞名时自动改名（`extracted` → `extracted1`）⇒ 不再出现
  `SyntaxError: Identifier 'extracted' has already been declared`。
- 抽取产物新增「仍可解析」自检：坏产物一律不出 edit。
