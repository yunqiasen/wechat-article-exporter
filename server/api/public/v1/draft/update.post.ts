/**
 * 更新草稿接口
 */

import { type DraftArticle, saveDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface UpdateDraftBody {
  appmsgid?: string;
  articles?: DraftArticle[];
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<UpdateDraftBody>(event);
  if (!body?.appmsgid) {
    return {
      base_resp: { ret: -1, err_msg: 'appmsgid不能为空' },
    };
  }
  if (!Array.isArray(body.articles) || body.articles.length === 0) {
    return {
      base_resp: { ret: -1, err_msg: 'articles 不能为空' },
    };
  }

  await commitWriteRequest(event, 'draft');

  try {
    const result = await saveDraft(event, ctx, body.articles, String(body.appmsgid));
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      appmsgid: result.appMsgId,
      images: result.images,
    };
  } catch (e) {
    console.error('更新草稿失败:', e);
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '更新草稿失败，请重试' },
    };
  }
});
