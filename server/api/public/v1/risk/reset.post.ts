/**
 * 手动解除当前公众号的写操作熔断
 *
 * @description 仅解除本项目的本地保护状态，不会绕过微信侧限制。若微信仍返回风控信号，下一次写操作会再次熔断。
 */

import { resetMpRiskState } from '~/server/utils/mp-risk';
import { guardWriteRequest } from '~/server/utils/mp-write-guard';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    throw createError({ statusCode: 401, statusMessage: '登录态无效' });
  }

  const authKey = getAuthKeyFromRequest(event);
  await resetMpRiskState(authKey);

  return {
    base_resp: { ret: 0, err_msg: 'ok' },
    reset: true,
  };
});
