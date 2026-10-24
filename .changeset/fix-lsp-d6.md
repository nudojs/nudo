---
"@nudojs/lsp": patch
---

族 22 修复 D6：Bug 716 722 724 725 911 951 —— hover / CodeLens / inlay hint 面与 `nudo check` 对齐。

- inlay hint 面无视请求区间：`textDocument/inlayHint` 的 `range` 是必填且表示
  「只请求该区间」，但服务端从不读它 ⇒ 两个不相交的区间返回**逐字节相同**的
  整文件 hint 集，客户端的局部刷新被无视、无关区段的 hint 反复重绘。现在
  返回的 hint 落在请求区间内（区间缺省时仍给整文件集，不丢内容）。
- CRLF 源文件上的 inlay hint 位置越界 1 列：服务端按 `\n` 切行，行尾的 `\r`
  被算进行长 ⇒ end-of-line hint 的 `character` 比客户端算出的可见行长多 1
  （LSP 里行终止符不属于该行）。切行改成 CRLF 感知，服务端行长与客户端的
  可见行长一致。
- hover 首行的契约档位恒为「激活」：hover 渲染 `● contract / …` 时没把观察
  选择器的状态带上（默认值就是激活），而同一文件的 CodeLens 在选中 case 后
  已翻成 `○ contract / …` ⇒ 同一个 IDE 里两个面互相打脸。现在 hover 与
  CodeLens 同源：选中 case 时契约档两处一起翻 `○`。
- 观察透镜是死链：服务端 CodeLens 把 `entry@` / `call@` 透镜交给客户端执行
  `nudo.trace`，但 VS Code 扩展从未注册这个命令 ⇒ 点了报「command
  'nudo.trace' not found」，观察透镜 100% 不可用。扩展补注册该命令（转发到
  服务端的 `nudo/trace`），manifest 的 `contributes.commands` 一并登记。
- hover 签名块整段丢掉 `throws` 通道：Abs 的四槽（shape × term × pred ×
  conf）没有 throws 槽 ⇒ IDE 里显示「不会抛」，而 `nudo check` 同一函数判
  `nudo:entry-may-throw`（error）⇒ 跨产品面自相矛盾，并违反
  `api/lsp.md` 明写的「check-identical signature」承诺。签名块现在按 check
  签名行的同款格式带上 `throws <Type>`（见证面证据；无证据时省略，不写
  `throws never`；非导出函数不带——CLI 的 L2 throws 只对 entry 生效）。
- hover 签名块的返回类型按 `maxDepth: 4` 截断：同一份源码、同一函数、同一次
  分析下，`nudo check` 签名行 / 同文档的 inlayHint / `nudo.hover` 载荷给出
  三个互不相同的类型（越深的结构，hover 给的信息越少——深度 8 与深度 4 的
  hover 输出逐字节相同）。返回类型改走共享投影预算（与 check 同口径）。
