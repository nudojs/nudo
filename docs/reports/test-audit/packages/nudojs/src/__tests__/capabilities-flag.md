# packages/nudojs/src/__tests__/capabilities-flag.test.ts

模块：CLI `--capabilities strict|trusted`。产品契约是“命令面 × 取值 × 退出码”的矩阵，而不是逐个 bug 的 4 条断言；check 面接收旗标但不产生 capability 诊断，test 面按 strict/trusted 切换 denied 与 builtin-unknown。

```audit
title	rootCause	gap	action	status	evidence
$name	模块矩阵覆盖 test/check 两个命令面、strict/trusted/非法三档、空格与等号两种旗标形态；旧用例只覆盖 test 面与部分取值，check 面与等号形态缺失。	夹具漏形态	optimize	done	commit:08c608c7
```
