/**
 * 删除当前公众号的网络配置，恢复服务器默认直连
 */

import { getMpCookie } from '~/server/kv/cookie';
import { removeMpNetworkProfile } from '~/server/utils/mp-network-profile';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey || !(await getMpCookie(authKey))) {
    throw createError({ statusCode: 401, statusMessage: '登录态无效' });
  }

  await removeMpNetworkProfile(authKey);

  return {
    base_resp: { ret: 0, err_msg: 'ok' },
    removed: true,
  };
});
