/**
 * 预览草稿接口
 *
 * @description 把草稿发送到指定微信号预览，不消耗群发额度。
 * 接收方需为该公众号的管理员或运营者。
 */

import { previewDraft } from '~/server/utils/mp-draft';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface PreviewDraftBody {
  appmsgid?: string;
  wxname?: string;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<PreviewDraftBody>(event);
  if (!body?.appmsgid) {
    return {
      base_resp: { ret: -1, err_msg: 'appmsgid不能为空' },
    };
  }
  if (!body.wxname) {
    return {
      base_resp: { ret: -1, err_msg: 'wxname不能为空（接收预览的微信号，需为该公众号管理员或运营者）' },
    };
  }

  await commitWriteRequest(event, 'preview');

  return previewDraft(event, ctx, String(body.appmsgid), String(body.wxname)).catch(e => {
    console.error('预览草稿失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '预览草稿失败，请重试' },
    };
  });
});
