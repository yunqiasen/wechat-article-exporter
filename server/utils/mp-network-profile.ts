/**
 * 按公众号账号（authKey）绑定独立出口代理与浏览器请求头
 *
 * @description Vercel 的 Nitro `vercel` preset 运行在 Node Serverless Function，支持 undici ProxyAgent。
 * 未配置时返回 null，proxyMpRequest 完全沿用原来的全局 fetch，确保兼容现有读取/下载逻辑。
 *
 * 注意：代理只能改变出口 IP；TLS 指纹属于 Node/undici，不能通过 UA 伪装成真实 Chrome。
 */

import { H3Event } from 'h3';
import type { Dispatcher } from 'undici';
import { setKvWithTtl } from '~/server/utils/kv-ttl';

export interface MpNetworkProfile {
  // HTTP/HTTPS 代理 URL，可含账号密码。SOCKS 暂不支持（undici ProxyAgent 只支持 HTTP(S) CONNECT 代理）
  proxyUrl: string;
  userAgent: string;
  acceptLanguage: string;
  enabled: boolean;
  updatedAt: number;
}

export type MpNetworkProfileInput = Partial<
  Pick<MpNetworkProfile, 'proxyUrl' | 'userAgent' | 'acceptLanguage' | 'enabled'>
>;

const LOGIN_SESSION_HEADER = 'X-Mp-Network-Session';
const LOGIN_PROFILE_TTL = 15 * 60;

function loginProfileKey(sessionId: string): string {
  return `login-network-profile:${sessionId}`;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function normalizeNetworkProfile(
  input: MpNetworkProfileInput,
  current: MpNetworkProfile | null
): Promise<MpNetworkProfile> {
  const proxyUrl = String(input.proxyUrl ?? current?.proxyUrl ?? '').trim();
  if (proxyUrl && !/^https?:\/\//i.test(proxyUrl)) {
    throw new Error('当前仅支持 http:// 或 https:// 代理 URL');
  }

  return {
    proxyUrl,
    userAgent: String(input.userAgent ?? current?.userAgent ?? DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT,
    acceptLanguage: String(input.acceptLanguage ?? current?.acceptLanguage ?? 'zh-CN,zh;q=0.9').trim(),
    enabled: input.enabled ?? current?.enabled ?? true,
    updatedAt: Date.now(),
  };
}

function profileKey(authKey: string): string {
  return `network-profile:${authKey}`;
}

/**
 * 扫码登录过程中 authKey 尚未生成，网络配置先按随机 sessionId 存在 KV（15 分钟）。
 * 最终登录成功后迁移到 authKey 对应的长期配置，避免代理凭据在轮询请求里反复传输。
 */
export async function createLoginNetworkProfile(input: MpNetworkProfileInput): Promise<string> {
  const profile = await normalizeNetworkProfile(input, null);
  const sessionId = crypto.randomUUID().replace(/-/g, '');
  await setKvWithTtl(loginProfileKey(sessionId), profile, LOGIN_PROFILE_TTL);
  return sessionId;
}

export async function getLoginNetworkProfile(event: H3Event): Promise<MpNetworkProfile | null> {
  const sessionId = getRequestHeader(event, LOGIN_SESSION_HEADER)?.trim();
  if (!sessionId) {
    return null;
  }
  return (await useStorage('kv').get<MpNetworkProfile>(loginProfileKey(sessionId))) || null;
}

export async function persistLoginNetworkProfile(event: H3Event, authKey: string) {
  const sessionId = getRequestHeader(event, LOGIN_SESSION_HEADER)?.trim();
  if (!sessionId) {
    return;
  }
  const kv = useStorage('kv');
  const profile = await kv.get<MpNetworkProfile>(loginProfileKey(sessionId));
  if (profile) {
    await kv.set(profileKey(authKey), profile);
    await kv.remove(loginProfileKey(sessionId));
  }
}

export async function getMpNetworkProfile(authKey: string): Promise<MpNetworkProfile | null> {
  if (!authKey) {
    return null;
  }
  return (await useStorage('kv').get<MpNetworkProfile>(profileKey(authKey))) || null;
}

export async function setMpNetworkProfile(authKey: string, input: MpNetworkProfileInput): Promise<MpNetworkProfile> {
  if (!authKey) {
    throw new Error('authKey不能为空');
  }

  const current = await getMpNetworkProfile(authKey);
  const profile = await normalizeNetworkProfile(input, current);

  await useStorage('kv').set(profileKey(authKey), profile);
  return profile;
}

export async function removeMpNetworkProfile(authKey: string) {
  await useStorage('kv').remove(profileKey(authKey));
}

/**
 * 对外返回脱敏后的配置，避免代理凭据泄露
 */
export function sanitizeNetworkProfile(profile: MpNetworkProfile | null) {
  if (!profile) {
    return null;
  }

  let proxy: string | null = null;
  if (profile.proxyUrl) {
    try {
      const url = new URL(profile.proxyUrl);
      if (url.username || url.password) {
        url.username = '***';
        url.password = '***';
      }
      proxy = url.toString();
    } catch {
      proxy = '(invalid)';
    }
  }

  return {
    proxyUrl: proxy,
    userAgent: profile.userAgent,
    acceptLanguage: profile.acceptLanguage,
    enabled: profile.enabled,
    updatedAt: profile.updatedAt,
  };
}

const dispatcherCache = new Map<string, Dispatcher>();

/**
 * 创建本次请求使用的 undici dispatcher
 *
 * @returns 未启用代理时返回 undefined，调用方继续使用原生 fetch
 */
export async function createMpDispatcher(profile: MpNetworkProfile | null): Promise<Dispatcher | undefined> {
  if (!profile?.enabled || !profile.proxyUrl) {
    return undefined;
  }

  const cached = dispatcherCache.get(profile.proxyUrl);
  if (cached) {
    return cached;
  }

  try {
    const { ProxyAgent } = await import('undici');
    const dispatcher = new ProxyAgent(profile.proxyUrl);
    dispatcherCache.set(profile.proxyUrl, dispatcher);
    return dispatcher;
  } catch (err) {
    throw new Error(`当前运行环境不支持账号独立代理（需要 Vercel/Node runtime）: ${err}`);
  }
}
