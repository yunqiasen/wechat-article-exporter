/**
 * 删除草稿接口
 */

import { deleteDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface DeleteDraftBody {
  appmsgid?: string;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<DeleteDraftBody>(event);
  if (!body?.appmsgid) {
    return {
      base_resp: { ret: -1, err_msg: 'appmsgid不能为空' },
    };
  }

  await commitWriteRequest(event, 'draft');

  return deleteDraft(event, ctx, String(body.appmsgid)).catch(e => {
    console.error('删除草稿失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '删除草稿失败，请重试' },
    };
  });
});
