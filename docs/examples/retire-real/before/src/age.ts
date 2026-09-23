/**
 * 真实依赖：npm `ms`（vercel/ms，纯 JS）。
 * 迁移前：消费方仍用 tsc + @types/ms 把关。
 */
import ms from "ms";

export function formatAge(durationMs: number): string {
  return ms(durationMs, { long: true });
}

export function parseAge(text: string): number {
  return ms(text);
}

formatAge(90_000);
parseAge("2d");
