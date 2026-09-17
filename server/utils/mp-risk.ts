/**
 * 微信写操作风控守卫
 *
 * @description 目标不是伪装真人，而是避免脚本表现出滥用特征：
 * - 每个 authKey 独立节流（多个公众号互不影响）
 * - 限制滚动窗口内的写操作总量
 * - 遇到登录失效、验证码、频率限制等响应后熔断，不自动重试
 * - 状态存在 Nitro KV，Vercel 多实例之间也能共享
 *
 * 只接入新增的写端点，不影响原项目的搜索、下载、导出逻辑。
 */

import { H3Event, parseCookies } from 'h3';
import { setKvWithTtl } from '~/server/utils/kv-ttl';

function getAuthKey(event: H3Event): string {
  return getRequestHeader(event, 'X-Auth-Key') || parseCookies(event)['auth-key'] || '';
}

const MIN_INTERVAL_MS = 4_000;
const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 8;
const DEFAULT_CIRCUIT_MS = 30 * 60_000;
const LOGIN_CIRCUIT_MS = 5 * 60_000;

interface RiskState {
  lastWriteAt: number;
  windowStartedAt: number;
  writesInWindow: number;
  circuitUntil: number;
  circuitReason: string;
  lastRet: number | null;
}

export type MpRiskAction = 'material' | 'draft' | 'preview' | 'publish' | 'comment' | 'settings';

export interface MpRiskSignal {
  ret: number;
  category: 'ok' | 'auth' | 'rate_limit' | 'verification' | 'account_restricted' | 'request_error';
  shouldCircuit: boolean;
  circuitMs: number;
  message: string;
}

const DEFAULT_STATE: RiskState = {
  lastWriteAt: 0,
  windowStartedAt: 0,
  writesInWindow: 0,
  circuitUntil: 0,
  circuitReason: '',
  lastRet: null,
};

function riskKey(authKey: string): string {
  return `risk:${authKey}`;
}

/**
 * 微信内部响应码分类
 *
 * 这里只列项目中已确认或微信后台常见的信号；未知错误不自动归为风控，避免误熔断。
 */
export function classifyMpResponse(response: any): MpRiskSignal {
  const ret = Number(response?.base_resp?.ret ?? response?.ret ?? 0);
  const rawMessage = String(response?.base_resp?.err_msg ?? response?.err_msg ?? response?.msg ?? '').toLowerCase();

  if (ret === 0) {
    return { ret, category: 'ok', shouldCircuit: false, circuitMs: 0, message: 'ok' };
  }

  // 项目已使用 200003 表示登录态失效（apis/index.ts）
  if (ret === 200003 || /login|session|登录|会话|expired/.test(rawMessage)) {
    return {
      ret,
      category: 'auth',
      shouldCircuit: true,
      circuitMs: LOGIN_CIRCUIT_MS,
      message: '登录态已失效，暂停写操作并要求重新扫码',
    };
  }

  if (/频繁|frequency|too many|rate.?limit|busy/.test(rawMessage)) {
    return {
      ret,
      category: 'rate_limit',
      shouldCircuit: true,
      circuitMs: DEFAULT_CIRCUIT_MS,
      message: '微信返回频率限制，已熔断写操作',
    };
  }

  if (/captcha|verify|验证码|验证|滑块|安全校验/.test(rawMessage)) {
    return {
      ret,
      category: 'verification',
      shouldCircuit: true,
      circuitMs: DEFAULT_CIRCUIT_MS,
      message: '微信要求安全验证，已熔断写操作',
    };
  }

  if (/禁止|封禁|违规|restrict|forbid|risk/.test(rawMessage)) {
    return {
      ret,
      category: 'account_restricted',
      shouldCircuit: true,
      circuitMs: DEFAULT_CIRCUIT_MS,
      message: '账号功能受限，已熔断写操作',
    };
  }

  return {
    ret,
    category: 'request_error',
    shouldCircuit: false,
    circuitMs: 0,
    message: rawMessage || `微信接口返回错误码 ${ret}`,
  };
}

/**
 * 写操作前检查并占用一个操作槽位
 *
 * @throws 429 节流，423 熔断。不会等待或自动重试，调用方稍后主动重试即可。
 */
export async function beforeMpWrite(event: H3Event, action: MpRiskAction): Promise<string> {
  const authKey = getAuthKey(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: '缺少 X-Auth-Key 或 auth-key cookie' });
  }

  const kv = useStorage('kv');
  const now = Date.now();
  const state = { ...DEFAULT_STATE, ...((await kv.get<RiskState>(riskKey(authKey))) || {}) };

  if (state.circuitUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((state.circuitUntil - now) / 1000));
    setResponseHeader(event, 'Retry-After', retryAfter);
    throw createError({
      statusCode: 423,
      statusMessage: `该公众号写操作已熔断：${state.circuitReason || '检测到风控信号'}，${retryAfter} 秒后再试`,
    });
  }

  const elapsed = now - state.lastWriteAt;
  if (state.lastWriteAt > 0 && elapsed < MIN_INTERVAL_MS) {
    const retryAfter = Math.max(1, Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000));
    setResponseHeader(event, 'Retry-After', retryAfter);
    throw createError({
      statusCode: 429,
      statusMessage: `写操作过快，请 ${retryAfter} 秒后再试`,
    });
  }

  if (now - state.windowStartedAt >= WINDOW_MS) {
    state.windowStartedAt = now;
    state.writesInWindow = 0;
  }

  if (state.writesInWindow >= MAX_WRITES_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((state.windowStartedAt + WINDOW_MS - now) / 1000));
    setResponseHeader(event, 'Retry-After', retryAfter);
    throw createError({
      statusCode: 429,
      statusMessage: `该公众号 1 分钟内写操作已达 ${MAX_WRITES_PER_WINDOW} 次，请 ${retryAfter} 秒后再试`,
    });
  }

  state.lastWriteAt = now;
  state.writesInWindow++;
  state.circuitUntil = 0;
  state.circuitReason = '';
  await setKvWithTtl(riskKey(authKey), state, 60 * 60 * 24);

  setResponseHeader(event, 'X-Mp-Risk-Action', action);
  return authKey;
}

/**
 * 微信响应后记录风控信号
 */
export async function afterMpWrite(authKey: string, response: any): Promise<MpRiskSignal> {
  const signal = classifyMpResponse(response);
  const kv = useStorage('kv');
  const state = { ...DEFAULT_STATE, ...((await kv.get<RiskState>(riskKey(authKey))) || {}) };
  state.lastRet = signal.ret;

  if (signal.shouldCircuit) {
    state.circuitUntil = Date.now() + signal.circuitMs;
    state.circuitReason = signal.message;
  }

  await setKvWithTtl(riskKey(authKey), state, 60 * 60 * 24);
  return signal;
}

/**
 * 查询账号风控状态（供管理端点使用）
 */
export async function getMpRiskState(authKey: string): Promise<RiskState & { circuitActive: boolean }> {
  const state = { ...DEFAULT_STATE, ...((await useStorage('kv').get<RiskState>(riskKey(authKey))) || {}) };
  return { ...state, circuitActive: state.circuitUntil > Date.now() };
}

/**
 * 手动解除熔断。只应由已认证的管理请求调用。
 */
export async function resetMpRiskState(authKey: string) {
  await useStorage('kv').remove(riskKey(authKey));
}
