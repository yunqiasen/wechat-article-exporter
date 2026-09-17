/**
 * 上传图片素材接口
 *
 * @description multipart/form-data 上传，字段名 file。返回 media_id（用作封面）与 cdn_url（用于正文 img src）
 */

import { uploadImage } from '~/server/utils/mp-material';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const form = await readMultipartFormData(event);
  const filePart = form?.find(part => part.name === 'file' && part.filename);
  if (!filePart) {
    return {
      base_resp: { ret: -1, err_msg: '缺少 file 字段（需以 multipart/form-data 上传）' },
    };
  }

  await commitWriteRequest(event, 'material');

  try {
    const blob = new Blob([filePart.data], { type: filePart.type || 'image/jpeg' });
    const result = await uploadImage(event, ctx, blob, filePart.filename!);

    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      media_id: result.media_id,
      cdn_url: result.cdn_url,
    };
  } catch (e) {
    console.error('上传图片素材失败:', e);
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '上传图片失败，请重试' },
    };
  }
});
