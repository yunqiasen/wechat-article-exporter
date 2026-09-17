/**
 * 群发/定时发额度查询接口
 */

import { getQuota } from '~/server/utils/mp-publish';
import { AUTH_FAILED_RESPONSE, guardWriteRequest } from '~/server/utils/mp-write-guard';

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  try {
    const quota = await getQuota(event, ctx);
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      ...quota,
    };
  } catch (e) {
    console.error('查询发表额度失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '查询发表额度失败，请重试' },
    };
  }
});
