/**
 * 写接口的统一前置守卫
 *
 * @description 素材/草稿/发表/评论这些接口会真实修改公众号内容，与只读接口的差异在于：
 * 1. 一律要求会员令牌（`X-Api-Token`），游客直接 403
 * 2. 除 token 外还需要 ticket（见 mp-ticket.ts）
 * 这段逻辑在 18 个写端点中完全一致，抽到这里避免重复。
 */

import { H3Event } from 'h3';
import { beforeMpWrite, type MpRiskAction } from '~/server/utils/mp-risk';
import { getWriteContext, type MpWriteContext } from '~/server/utils/mp-ticket';
import { enforceRateLimit } from '~/server/utils/rate-limit';

/**
 * 写接口守卫：限流 → 会员校验 → 取 token/ticket
 *
 * @param event
 * @throws 403（非会员）/ 429（超限）
 * @returns 成功返回写上下文；登录态失效返回 null（由调用方返回 base_resp 错误）
 */
export async function guardWriteRequest(event: H3Event): Promise<MpWriteContext | null> {
  const { isMember, tokenStatus } = await enforceRateLimit(event, 'publish');

  // 会员/限速层开启时，写接口仅对会员开放
  if (useRuntimeConfig(event).public.membership.enabled && !isMember) {
    const hint =
      tokenStatus === 'expired' ? '会员令牌已过期，续费后恢复；' : tokenStatus === 'invalid' ? '会员令牌无效；' : '';
    throw createError({
      statusCode: 403,
      statusMessage: `${hint}该接口会修改公众号内容，仅限会员（请在请求头携带有效 X-Api-Token）`,
    });
  }

  return await getWriteContext(event);
}

/**
 * 参数校验通过后、真正向微信发 POST 前占用写槽位。
 */
export async function commitWriteRequest(event: H3Event, action: MpRiskAction) {
  return await beforeMpWrite(event, action);
}

// 登录态失效时的统一响应，与项目其他接口的 base_resp 惯例保持一致
export const AUTH_FAILED_RESPONSE = {
  base_resp: {
    ret: -1,
    err_msg: '未登录或登录已过期，请重新扫码登录',
  },
};
