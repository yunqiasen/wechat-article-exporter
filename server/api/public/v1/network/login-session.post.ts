/**
 * 创建扫码登录使用的临时网络会话
 *
 * @description 代理凭据只在此请求提交一次，后续扫码链路仅携带随机 sessionId。
 * 会话 15 分钟后自动过期；登录成功后自动迁移到生成的 authKey。
 */

import { createLoginNetworkProfile, type MpNetworkProfileInput } from '~/server/utils/mp-network-profile';

export default defineEventHandler(async event => {
  // 该端点接收代理凭据，仅允许登录弹窗的同源请求调用。
  const origin = getRequestHeader(event, 'Origin');
  const host = getRequestHeader(event, 'X-Forwarded-Host') || getRequestHeader(event, 'Host');
  if (!origin || !host || new URL(origin).host !== host) {
    throw createError({ statusCode: 403, statusMessage: '登录网络会话仅允许同源请求' });
  }

  // Vercel Serverless 的 memory driver 无法保证四段扫码请求落到同一个实例。
  // 不阻断原有无代理登录；仅在用户启用账号代理时要求持久化 KV。
  const hasPersistentKv =
    (process.env.NITRO_KV_DRIVER && process.env.NITRO_KV_DRIVER !== 'memory') ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (process.env.VERCEL && !hasPersistentKv) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'Vercel 多实例下登录代理需要持久化 KV。请在 Vercel 添加 Upstash Redis，并设置 NITRO_KV_DRIVER=upstash',
      },
    };
  }

  const body = await readBody<MpNetworkProfileInput>(event);
  if (!body?.proxyUrl?.trim()) {
    return { base_resp: { ret: -1, err_msg: 'proxyUrl不能为空' } };
  }

  try {
    const sessionId = await createLoginNetworkProfile(body || {});
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      session_id: sessionId,
      expires_in: 15 * 60,
    };
  } catch (e) {
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '创建登录网络会话失败' },
    };
  }
});
