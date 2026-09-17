/**
 * 查询当前公众号的网络配置（代理凭据会脱敏）
 */

import { getMpNetworkProfile, sanitizeNetworkProfile } from '~/server/utils/mp-network-profile';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey) {
    throw createError({ statusCode: 401, statusMessage: '缺少 X-Auth-Key 或 auth-key cookie' });
  }

  return {
    base_resp: { ret: 0, err_msg: 'ok' },
    profile: sanitizeNetworkProfile(await getMpNetworkProfile(authKey)),
  };
});
