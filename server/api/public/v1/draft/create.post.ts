/**
 * 创建草稿接口
 *
 * @description articles 数组支持多图文（主图文 + 次条），单篇传一个元素。
 * 正文中的外域图片会自动转存到微信 CDN。
 */

import { type DraftArticle, saveDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface CreateDraftBody {
  articles?: DraftArticle[];
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<CreateDraftBody>(event);
  if (!Array.isArray(body?.articles) || body.articles.length === 0) {
    return {
      base_resp: { ret: -1, err_msg: 'articles 不能为空（数组，每个元素至少包含 title 与 content）' },
    };
  }

  await commitWriteRequest(event, 'draft');

  try {
    const result = await saveDraft(event, ctx, body.articles);
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      appmsgid: result.appMsgId,
      images: result.images,
    };
  } catch (e) {
    console.error('创建草稿失败:', e);
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '创建草稿失败，请重试' },
    };
  }
});
