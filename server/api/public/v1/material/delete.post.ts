/**
 * 删除素材接口
 */

import { deleteMaterial } from '~/server/utils/mp-material';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface DeleteMaterialBody {
  file_id?: string;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<DeleteMaterialBody>(event);
  if (!body?.file_id) {
    return {
      base_resp: { ret: -1, err_msg: 'file_id不能为空' },
    };
  }

  await commitWriteRequest(event, 'material');

  return deleteMaterial(event, ctx, String(body.file_id)).catch(e => {
    console.error('删除素材失败:', e);
    return {
      base_resp: { ret: -1, err_msg: '删除素材失败，请重试' },
    };
  });
});
