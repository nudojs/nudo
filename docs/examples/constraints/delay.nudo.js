// 通用约束模板：不绑定任何参数名
// number() 约束原语；链式在运行时组装 Pred（占位项 self）

import { number } from "@nudojs/core";

/** 延时：self > 0 */
export const delay = number().gt(0);

/** 正数：self > 0（与 delay 同义，语义名不同） */
export const positive = number().gt(0);

/** 百分比：0 ≤ self ≤ 100 */
export const percent = number().ge(0).le(100);

/** 端口：self ≥ 1 */
export const port = number().ge(1);

/** 非负：self ≥ 0 */
export const nonNegative = number().ge(0);

// 同一文件可被任意业务 JS 引用，与文件名/变量名无关
