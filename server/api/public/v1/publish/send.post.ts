/**
 * 兼容入口：发表到“发表记录”（不群发通知粉丝）
 *
 * @description 旧路由保留以兼容已接入的调用方。新接入请优先使用 `/publish/freepublish`。
 * 默认只做预检，必须显式传 `confirm: true` 才会真正发表。
 */

import { checkIdempotency, freePublish, markIdempotency } from '~/server/utils/mp-publish';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';
import { getAuthKeyFromRequest } from '~/server/utils/proxy-request';

interface SendBody {
  appmsgid?: string;
  confirm?: boolean;
}

export default defineEventHandler(async event => {
  const body = await readBody<SendBody>(event);
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  if (!body?.appmsgid) {
    return { base_resp: { ret: -1, err_msg: 'appmsgid不能为空' } };
  }
  const appMsgId = String(body.appmsgid);

  if (body.confirm !== true) {
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      dry_run: true,
      mode: 'freepublish',
      notifies_followers: false,
      appmsgid: appMsgId,
      hint: '预检通过。带 confirm=true 再次调用后，文章将进入发表记录，不会群发通知粉丝',
    };
  }

  await commitWriteRequest(event, 'publish');

  const authKey = getAuthKeyFromRequest(event);
  const duplicated = await checkIdempotency(authKey, 'freepublish', appMsgId);
  if (duplicated) {
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      appmsgid: appMsgId,
      duplicated: true,
      hint: '该草稿最近 10 分钟内已提交发表，本次未重复操作',
    };
  }

  try {
    const resp = await freePublish(event, ctx, appMsgId);
    const ret = String(resp?.base_resp?.ret ?? resp?.ret ?? '-1');
    if (ret !== '0') {
      return {
        base_resp: { ret: -1, err_msg: `发表失败 ret=${ret}: ${resp?.base_resp?.err_msg || ''}` },
        raw: resp,
      };
    }

    await markIdempotency(authKey, 'freepublish', appMsgId, appMsgId);
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      mode: 'freepublish',
      notifies_followers: false,
      appmsgid: appMsgId,
      raw: resp,
    };
  } catch (e) {
    console.error('发表失败:', e);
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '发表失败，请重试' },
    };
  }
});
