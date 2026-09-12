// object 形状契约模板（参数无关）
// 不需要 interface / type 语法——契约是可执行的 JS 表达式

import { number, string, shape } from "@nudojs/core";

/** 用户：id > 0，name 为 string */
export const user = shape({
  id: number().gt(0),
  name: string(),
});

/** 配置：retries 0..5，label 可选 */
export const config = shape({
  retries: number().ge(0).le(5),
  label: string().optional(),
});
