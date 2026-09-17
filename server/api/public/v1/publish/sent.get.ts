/**
 * 发表记录接口
 *
 * @description 微信返回的 publish_page 是 JSON 字符串，这里额外提供已解析的 publish_page_parsed
 */

import { listSent } from '~/server/utils/mp-publish';
import { AUTH_FAILED_RESPONSE, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface SentQuery {
  begin?: number;
  count?: number;
  keyword?: string;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const query = getQuery<SentQuery>(event);

  return listSent(event, ctx, {
    begin: query.begin ? Number(query.begin) : undefined,
    count: query.count ? Number(query.count) : undefined,
    keyword: query.keyword,
  }).catch(e => {
    console.error('获取发表记录失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '获取发表记录失败，请重试' },
    };
  });
});
