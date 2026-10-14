// 相似度契约：d ≥ 0、max ≥ 1，返回 1 - d/max ∈ [0,1]
// 常数界在这里（侧车）；跨变量引理 d <= max 在源文件 @nudo:assume —— 分工：
// 常数界用构建器（number().ge(0).le(1)），变量间关系引擎推导不出，用引理声明。

import { fn, number } from "@nudojs/core";

export const sim = fn(
  { d: number().ge(0), max: number().ge(1) },
  number().ge(0).le(1),
);
