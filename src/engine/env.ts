/** 구독 로그인 대신 다른 과금 경로로 몰래 바뀌는 것을 막기 위해 자식에서 지우는 변수(이음오피스 SUBSCRIPTION_STRIPPED_ENV_VARS) */
export const STRIPPED_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
];

/** Claude Code 자식 프로세스(상태 점검·로그인 창·전사)에 줄 환경. 원본은 바꾸지 않는다. */
export function childEnv(base: NodeJS.ProcessEnv, opts: { configDir?: string } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of STRIPPED_ENV_VARS) delete env[k];
  if (opts.configDir !== undefined) { if (opts.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir; else delete env.CLAUDE_CONFIG_DIR; }
  env.DISABLE_AUTOUPDATER = '1';
  env.DISABLE_TELEMETRY = '1';
  return env;
}
