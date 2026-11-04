/**
 * github-slugger@1.5.0 不带类型声明（2.x 起才内置）——测试用的最小面。
 * 只声明本仓测试实际消费的 API（slug / reset）。
 */
declare module "github-slugger" {
  export default class GithubSlugger {
    slug(value: string): string;
    reset(): void;
  }
}
