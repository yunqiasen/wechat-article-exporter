/**
 * 微信公众号写操作上下文（token + ticket）
 *
 * @description 公众号后台的写接口（创建草稿、群发、评论操作等）除 token 外还要求 ticket 字段，
 * ticket 只能从后台首页 HTML 中提取。这里按 authKey 缓存，避免每次写操作都多打一次首页请求。
 */

import { H3Event } from 'h3';
import { getTokenFromStore } from '~/server/utils/CookieStore';
import { setKvWithTtl } from '~/server/utils/kv-ttl';
import { getAuthKeyFromRequest, proxyMpRequest } from '~/server/utils/proxy-request';

// ticket 缓存时长（秒）。ticket 与登录态同生命周期，这里取较短的 2 小时以便及时刷新
const TICKET_TTL = 60 * 60 * 2;

export interface MpWriteContext {
  token: string;
  ticket: string;
}

/**
 * 从后台首页 HTML 中提取 ticket
 *
 * @description 首页里的形式为 `window.wx.commonData = { ..., ticket: "xxx", ... }`
 */
function extractTicket(html: string): string | null {
  const match = html.match(/ticket:\s*"(?<ticket>[0-9a-f]{20,})"/);
  return match?.groups?.ticket ?? null;
}

/**
 * 获取 ticket（优先读缓存，缓存未命中则请求后台首页提取）
 * @param event
 * @param token 公众号 token
 */
export async function getTicket(event: H3Event, token: string): Promise<string | null> {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    return null;
  }

  const kv = useStorage('kv');
  const cacheKey = `ticket:${authKey}`;

  const cached = await kv.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const html: string = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/home',
    query: {
      t: 'home/index',
      token: token,
      lang: 'zh_CN',
    },
  }).then(resp => resp.text());

  const ticket = extractTicket(html);
  if (!ticket) {
    return null;
  }

  try {
    await setKvWithTtl(cacheKey, ticket, TICKET_TTL);
  } catch (err) {
    // 缓存写入失败不影响本次调用
    console.error('ticket 缓存写入失败:', err);
  }

  return ticket;
}

/**
 * 获取写操作所需的完整上下文（token + ticket）
 *
 * @description 写接口的统一入口，任一项缺失即视为登录态失效
 * @returns 成功返回 { token, ticket }，失败返回 null
 */
export async function getWriteContext(event: H3Event): Promise<MpWriteContext | null> {
  const token = await getTokenFromStore(event);
  if (!token) {
    return null;
  }

  const ticket = await getTicket(event, token);
  if (!ticket) {
    return null;
  }

  return { token, ticket };
}
