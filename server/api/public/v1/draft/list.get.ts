/**
 * 草稿列表接口
 */

import { listDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface DraftListQuery {
  begin?: number;
  count?: number;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const query = getQuery<DraftListQuery>(event);

  return listDraft(event, ctx, {
    begin: query.begin ? Number(query.begin) : undefined,
    count: query.count ? Number(query.count) : undefined,
  }).catch(e => {
    console.error('获取草稿列表失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '获取草稿列表失败，请重试' },
    };
  });
});
