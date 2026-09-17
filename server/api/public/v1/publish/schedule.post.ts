/**
 * 定时发接口
 *
 * @description 微信没有独立的定时发端点：先以带 pre_timesend_set 的方式保存草稿，
 * 再走群发入口提交。定时发额度（time_send_oper_left）比群发宽松。
 */

import { type DraftArticle, getDraft, saveDraft } from '~/server/utils/mp-draft';
import { checkHotTime, freePublish, getQuota } from '~/server/utils/mp-publish';
import { AUTH_FAILED_RESPONSE, commitWriteRequest, guardWriteRequest } from '~/server/utils/mp-write-guard';

interface ScheduleBody {
  appmsgid?: string;
  articles?: DraftArticle[];
  // 定时发送时间：unix 秒，或可被 Date 解析的字符串
  send_at?: number | string;
  confirm?: boolean;
}

export default defineEventHandler(async event => {
  const ctx = await guardWriteRequest(event);
  if (!ctx) {
    return AUTH_FAILED_RESPONSE;
  }

  const body = await readBody<ScheduleBody>(event);
  if (!body?.send_at) {
    return {
      base_resp: { ret: -1, err_msg: 'send_at不能为空（unix 秒或可解析的时间字符串）' },
    };
  }
  if (!body.appmsgid && (!Array.isArray(body.articles) || body.articles.length === 0)) {
    return {
      base_resp: { ret: -1, err_msg: '需提供 appmsgid（已有草稿）或 articles（新建草稿）' },
    };
  }

  // 归一化时间：数字按 unix 秒处理，字符串交给 Date 解析
  const sendAt =
    typeof body.send_at === 'number' ? Math.floor(body.send_at) : Math.floor(new Date(body.send_at).getTime() / 1000);
  if (!Number.isFinite(sendAt) || sendAt <= 0) {
    return {
      base_resp: { ret: -1, err_msg: 'send_at 格式无法解析' },
    };
  }
  const now = Math.floor(Date.now() / 1000);
  if (sendAt <= now) {
    return {
      base_resp: { ret: -1, err_msg: 'send_at 必须是将来的时间' },
    };
  }

  const quota = await getQuota(event, ctx);
  const hotTime = await checkHotTime(event, ctx, sendAt).catch(() => null);

  if (body.confirm !== true) {
    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      dry_run: true,
      send_at: sendAt,
      send_at_readable: new Date(sendAt * 1000).toISOString(),
      quota: quota,
      hot_time: hotTime,
      hint: '预检通过。确认无误后请带上 confirm=true 再次调用以真正设置定时发送',
    };
  }

  if (quota.time_send_oper_left <= 0) {
    return {
      base_resp: { ret: -1, err_msg: '定时发操作额度已用尽' },
      quota: quota,
    };
  }

  await commitWriteRequest(event, 'publish');

  try {
    // 只给 appmsgid 时先取回原草稿内容，避免以空 articles 覆盖已有正文
    let articles = body.articles;
    if (!articles || articles.length === 0) {
      const existing = await getDraft(event, ctx, String(body.appmsgid));
      if (!existing.raw_found || existing.articles.length === 0) {
        return {
          base_resp: { ret: -1, err_msg: `未能读取草稿 ${body.appmsgid} 的内容，请改为直接传 articles` },
        };
      }
      articles = existing.articles.map(item => ({
        title: item.title,
        content: item.content,
        author: item.author,
        digest: item.digest,
        cover: item.cover,
        source_url: item.source_url,
      }));
    }

    const saved = await saveDraft(event, ctx, articles, body.appmsgid ? String(body.appmsgid) : undefined, sendAt);

    const resp = await freePublish(event, ctx, saved.appMsgId);
    const ret = String(resp?.base_resp?.ret ?? resp?.ret ?? '-1');
    if (ret !== '0') {
      return {
        base_resp: { ret: -1, err_msg: `设置定时发送失败 ret=${ret}: ${resp?.base_resp?.err_msg || ''}` },
        appmsgid: saved.appMsgId,
        raw: resp,
      };
    }

    return {
      base_resp: { ret: 0, err_msg: 'ok' },
      appmsgid: saved.appMsgId,
      send_at: sendAt,
      send_at_readable: new Date(sendAt * 1000).toISOString(),
      images: saved.images,
      raw: resp,
    };
  } catch (e) {
    console.error('设置定时发送失败:', e);
    return {
      base_resp: { ret: -1, err_msg: e instanceof Error ? e.message : '设置定时发送失败，请重试' },
    };
  }
});
