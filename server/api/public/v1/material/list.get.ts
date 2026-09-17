/**
 * 素材列表接口
 */

import { listMaterial } from '~/server/utils/mp-material';
import { AUTH_FAILED_RESPONSE, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface MaterialListQuery {
  // 2=图片，3=音频，4=视频，10=图文
  type?: number;
  begin?: number;
  count?: number;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const query = getQuery<MaterialListQuery>(event);

  return listMaterial(event, ctx, {
    type: query.type ? Number(query.type) : undefined,
    begin: query.begin ? Number(query.begin) : undefined,
    count: query.count ? Number(query.count) : undefined,
  }).catch(e => {
    console.error('获取素材列表失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '获取素材列表失败，请重试' },
    };
  });
});
