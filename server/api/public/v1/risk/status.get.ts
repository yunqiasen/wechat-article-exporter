/**
 * 查询当前公众号的写操作风控状态
 */

import { getMpRiskState } from '~/server/utils/mp-risk';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: '缺少 X-Auth-Key 或 auth-key cookie' });
  }

  return {
    base_resp: { ret: 0, err_msg: 'ok' },
    risk: await getMpRiskState(authKey),
  };
});
