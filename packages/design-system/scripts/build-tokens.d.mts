export interface TokenBuild {
  css: string;
  preset: string;
  ts: string;
  files: string[];
}
export function buildTokens(tokens: unknown, outDir?: string): TokenBuild;
