/**
 * 草稿详情接口
 *
 * @description 后台无返回 JSON 的详情接口，内部通过解析编辑页 HTML 取回正文
 */

import { getDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface DraftGetQuery {
  appmsgid?: string;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const query = getQuery<DraftGetQuery>(event);
  if (!query.appmsgid) {
    return {
      base_resp: { ret: -1, err_msg: 'appmsgid不能为空' },
    };
  }

  try {
    const draft = await getDraft(event, ctx, String(query.appmsgid));
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      ...draft,
    };
  } catch (e) {
    console.error('获取草稿详情失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '获取草稿详情失败，请重试' },
    };
  }
});
