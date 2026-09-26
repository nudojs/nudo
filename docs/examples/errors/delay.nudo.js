import { number, string } from "@nudojs/core";

/** ms > 0 */
export const delay = number().gt(0);
/** x > 0 */
export const positive = number().gt(0);
/** 非空串 */
export const name1 = string().min(1);
