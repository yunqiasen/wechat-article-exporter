/**
 * 设置当前公众号的独立出口代理与请求头
 */

import { getMpCookie } from '~/server/kv/cookie';
import {
  type MpNetworkProfileInput,
  sanitizeNetworkProfile,
  setMpNetworkProfile,
} from '~/server/utils/mp-network-profile';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

export default defineEventHandler(async event => {
  const authKey = getAuthKeyFromRequest(event);
  if (!authKey || !(await getMpCookie(authKey))) {
    throw createError({ statusCode: 401, statusMessage: '登录态无效' });
  }

  const body = await readBody<MpNetworkProfileInput>(event);

  try {
    const profile = await setMpNetworkProfile(authKey, body || {});
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      profile: sanitizeNetworkProfile(profile),
    };
  } catch (e) {
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '保存网络配置失败' },
    };
  }
});
