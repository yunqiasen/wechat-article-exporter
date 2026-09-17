/**
 * 发表管理（额度查询 / 群发 / 定时发 / 发表记录 / 撤回）
 *
 * @description 字段与端点取自后台 appmsg_edit、mass/send、publish_history 页面的打包 JS：
 * - 发表入口是 `masssend?t=ajax-response&for_check=1&is_release_publish_page=1`，body 仅需 appmsgid；
 *   虽然 URL 名为 masssend，但 `is_release_publish_page=1` 表示“发表到发表记录”，不会群发通知粉丝
 * - 定时发表不是独立端点，而是在保存草稿时带 `pre_timesend_set`（unix 秒），再走同一个发表入口
 * - 额度信息在 `masssendpage` 的响应里（mass_send_left / time_send_oper_left）
 * - 发表记录用 `appmsgpublish?sub=list`，返回的 publish_page 是 JSON 字符串需二次解析
 */

import { createHash } from 'node:crypto';
import { H3Event } from 'h3';
import { setKvWithTtl } from '~/server/utils/kv-ttl';
import { type MpWriteContext } from '~/server/utils/mp-ticket';
import { proxyMpRequest } from '~/server/utils/proxy-request';

// 幂等窗口（秒）。群发不可逆，短时间内重复提交同一内容视为误触
const IDEMPOTENCY_TTL = 600;

export interface SendQuota {
  // 剩余群发次数（订阅号每天 1 次，服务号每月 4 次）
  mass_send_left: number;
  // 剩余定时发操作次数
  time_send_oper_left: number;
  // 已设置的定时发条数
  time_send_total_num: number;
  vip_mass_send_left: number;
  is_force_not_masssend: number;
}

/**
 * 查询群发/定时发额度
 */
export async function getQuota(event: H3Event, ctx: MpWriteContext): Promise<SendQuota> {
  const resp = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/masssendpage',
    query: {
      t: 'mass/send',
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
    },
    parseJson: true,
  });

  return {
    mass_send_left: Number(resp?.mass_send_left ?? 0),
    time_send_oper_left: Number(resp?.time_send_oper_left ?? 0),
    time_send_total_num: Number(resp?.time_send_total_num ?? 0),
    vip_mass_send_left: Number(resp?.vip_mass_send_left ?? 0),
    is_force_not_masssend: Number(resp?.is_force_not_masssend ?? 0),
  };
}

/**
 * 发表到“发表记录”（不群发通知粉丝）
 *
 * @description URL 虽然名为 masssend，但后台在自由发表分支明确携带
 * `is_release_publish_page=1`。此操作不消耗订阅号每日群发通知次数。
 */
export function freePublish(event: H3Event, ctx: MpWriteContext, appMsgId: string) {
  return proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/masssend',
    query: {
      t: 'ajax-response',
      for_check: 1,
      is_release_publish_page: 1,
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: {
      appmsgid: appMsgId,
      ticket: ctx.ticket,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });
}

/**
 * 校验定时发时间是否落在热点时段
 *
 * @description 热点时段的定时消息可能被延后发送，这里把微信的提示透传给调用方
 */
export function checkHotTime(event: H3Event, ctx: MpWriteContext, timestamp: number) {
  return proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/masssend',
    query: {
      action: 'check_hot_time',
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: {
      timestamp: timestamp,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });
}

/**
 * 发表记录
 *
 * @description publish_page 字段是 JSON 字符串，这里解析后一并返回，避免调用方重复处理
 */
export async function listSent(
  event: H3Event,
  ctx: MpWriteContext,
  options: { begin?: number; count?: number; keyword?: string } = {}
) {
  const keyword = options.keyword?.trim();

  const resp = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish',
    query: {
      sub: keyword ? 'search' : 'list',
      begin: options.begin ?? 0,
      count: options.count ?? 10,
      query: keyword || undefined,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });

  let publishPage: unknown = null;
  if (typeof resp?.publish_page === 'string') {
    try {
      publishPage = JSON.parse(resp.publish_page);
    } catch (err) {
      console.error('解析 publish_page 失败:', err);
    }
  }

  return { ...resp, publish_page_parsed: publishPage };
}

/**
 * 幂等检查：同一份内容在窗口期内是否已提交过
 *
 * @description 群发与建草稿都不可逆，用内容摘要挡住重复提交
 * @returns 命中返回上次的结果，未命中返回 null
 */
export async function checkIdempotency(
  authKey: string,
  scope: string,
  payload: string
): Promise<{ hit: true; value: string } | null> {
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  const cached = await useStorage('kv').get<string>(`idem:${scope}:${authKey}:${hash}`);
  return cached ? { hit: true, value: cached } : null;
}

/**
 * 记录幂等标记
 */
export async function markIdempotency(authKey: string, scope: string, payload: string, value: string) {
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  try {
    await setKvWithTtl(`idem:${scope}:${authKey}:${hash}`, value, IDEMPOTENCY_TTL);
  } catch (err) {
    // 幂等标记写入失败不应阻断主流程
    console.error('幂等标记写入失败:', err);
  }
}
