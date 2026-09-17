// object 形状契约（vs-ts structure 对照）
import { number, string, shape } from "@nudojs/core";

export const user = shape({
  id: number(),
  name: string(),
});
