import { EngineError } from './provider.js';

export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
export const MODEL = 'claude-opus-5-5';
const INIT_ID = 'initialize';

/** 고정 플래그 + 모델 + effort + 스키마. `--bare`는 구독 로그인을 읽지 않으므로 쓰지 않는다. */
export function launchArgs(schema: Record<string, unknown>, effort: string, model: string = MODEL): string[] {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--restricted', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
    '--model', model, '--effort', effort, '--json-schema', JSON.stringify(schema)];
}

export const initializeLine = (systemPrompt: string): string =>
  `${JSON.stringify({ type: 'control_request', request_id: INIT_ID, request: { subtype: 'initialize', systemPrompt: [systemPrompt] } })}\n`;

export const userLine = (images: string | string[] | undefined, text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: [
    ...(Array.isArray(images) ? images : images ? [images] : []).map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    { type: 'text', text } ] } })}\n`;

export type Outcome =
  | { type: 'none' } | { type: 'write'; line: string }
  | { type: 'done'; output: unknown; usage?: { input?: number; output?: number } }
  | { type: 'fail'; error: EngineError };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (kind: EngineError['kind'], msg: string, resetsAt?: number): Outcome => ({ type: 'fail', error: new EngineError(kind, msg, resetsAt) });

function classify(code: string | undefined, status: unknown, text: string, resetsAt?: number): EngineError {
  const m = text.trim() || 'Claude Code가 오류를 보고함';
  if (code === 'authentication_failed' || status === 401) return new EngineError('signed-out', m);
  if (code === 'rate_limit' || status === 429) return new EngineError('rate-limit', m, resetsAt);
  if (code === 'overloaded' || status === 529 || status === 503) return new EngineError('overloaded', m);
  if (/connection error|unable to connect|ENOTFOUND|ECONNRESET|fetch failed/i.test(m)) return new EngineError('network', m);
  if (/timed out|timeout/i.test(m)) return new EngineError('timeout', m);
  if (/not logged in|please run \/login|invalid api key|authentication/i.test(m)) return new EngineError('signed-out', m);
  return new EngineError('other', m);
}

/** 한 턴의 상태 기계: stdout 줄을 받아 할 일을 돌려준다 */
export class CliTurn {
  initialized = false;
  verified = false;
  private failureCode?: string;
  private failureText = '';
  private resetsAt?: number;
  constructor(private readonly userLineToSend: string) {}

  onLine(line: string): Outcome {
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { return { type: 'none' }; }
    if (!isObj(ev)) return { type: 'none' };
    switch (ev.type) {
      case 'control_response': {
        const r = ev.response;
        if (!isObj(r) || r.request_id !== INIT_ID || this.initialized) return { type: 'none' };
        if (r.subtype !== 'success') return fail('needs-update', 'Claude Code가 설정 요청을 받지 않음(너무 오래된 버전일 수 있음)');
        this.initialized = true;
        return { type: 'write', line: this.userLineToSend };
      }
      case 'control_request': {
        const sub = isObj(ev.request) ? ev.request.subtype : undefined;
        if (sub === 'can_use_tool') return fail('unsafe-tools', 'Claude Code가 도구 사용 허가를 요청함');
        return { type: 'write', line: `${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: ev.request_id, error: `Unsupported request: ${String(sub)}` } })}\n` };
      }
      case 'system': {
        if (ev.subtype !== 'init') return { type: 'none' };
        const tools = Array.isArray(ev.tools) ? ev.tools : null;
        if (!tools) return fail('unsafe-tools', 'Claude Code가 도구 목록을 보고하지 않음');
        const exact = tools.length === 1 && tools[0] === STRUCTURED_OUTPUT_TOOL;
        if (!exact) return fail('unsafe-tools', `도구 ${tools.length}개와 함께 시작됨 (${tools.slice(0, 5).join(', ')})`);
        const servers = ev.mcp_servers;
        if (Array.isArray(servers) ? servers.length > 0 : servers != null) return fail('unsafe-tools', 'MCP 서버가 붙어 있음');
        this.verified = true;
        return { type: 'none' };
      }
      case 'rate_limit_event': {
        const info = ev.rate_limit_info;
        if (isObj(info) && info.status === 'rejected' && typeof info.resetsAt === 'number') this.resetsAt = Math.round(info.resetsAt * 1000);
        return { type: 'none' };
      }
      case 'assistant': {
        const content = isObj(ev.message) ? ev.message.content : undefined;
        if (typeof ev.error === 'string') {
          this.failureCode = ev.error;
          this.failureText = Array.isArray(content) ? content.map(b => (isObj(b) && b.type === 'text' ? b.text : '')).join('') : '';
          return { type: 'none' };
        }
        if (!this.verified) return fail('unsafe-tools', 'Claude Code가 도구 목록을 보고하기 전에 답하기 시작함');
        for (const b of Array.isArray(content) ? content : [])
          if (isObj(b) && /tool_use$/.test(String(b.type)) && b.name !== STRUCTURED_OUTPUT_TOOL) return fail('unsafe-tools', `도구 호출: ${String(b.name).slice(0, 80)}`);
        return { type: 'none' };
      }
      case 'user': {
        const content = isObj(ev.message) ? ev.message.content : undefined;
        // StructuredOutput의 확인 응답 외의 tool_result는 도구가 실행된 것
        const ran = Array.isArray(content) && content.some(b => isObj(b) && b.type === 'tool_result' && b.is_error === true);
        return ran ? fail('unsafe-tools', 'Claude Code가 도구를 실행함') : { type: 'none' };
      }
      case 'result': {
        const text = typeof ev.result === 'string' ? ev.result : '';
        if (ev.is_error === true || ev.subtype !== 'success') {
          const errors = Array.isArray(ev.errors) ? ev.errors.join('; ') : '';
          return { type: 'fail', error: classify(this.failureCode, ev.api_error_status, text || this.failureText || errors, this.resetsAt) };
        }
        if (!this.verified) return fail('unsafe-tools', 'Claude Code가 도구 목록을 보고하기 전에 끝남');
        if (ev.stop_reason === 'refusal') return fail('refusal', '모델이 거절함');
        if (!isObj(ev.structured_output)) return fail('invalid-output', 'Claude Code가 구조화 출력 없이 끝남');
        const u = isObj(ev.usage) ? ev.usage : {};
        return { type: 'done', output: ev.structured_output, usage: { input: typeof u.input_tokens === 'number' ? u.input_tokens : undefined, output: typeof u.output_tokens === 'number' ? u.output_tokens : undefined } };
      }
      default: return { type: 'none' };
    }
  }

  onExit(code: number | null, stderr: string): Outcome {
    const d = stderr.trim();
    if (/unknown option|unknown argument|unrecognized option/i.test(d)) return fail('needs-update', 'Claude Code가 이 프로그램의 옵션을 모름(너무 오래된 버전)');
    if (/not logged in|please run \/login|invalid api key|authentication/i.test(d)) return fail('signed-out', 'Claude Code에 로그인되어 있지 않음');
    return fail('other', `Claude Code가 답하기 전에 끝남 (${code ?? 'unknown'})${d ? `: ${d.slice(0, 500)}` : ''}`);
  }
}
