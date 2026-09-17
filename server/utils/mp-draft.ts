/**
 * 草稿管理（创建 / 更新 / 删除 / 列表 / 详情 / 预览）
 *
 * @description 字段名与请求形式均取自公众号后台 appmsg_edit 页面的打包 JS（appmsg.save / appmsg.preview），
 * 而非公开文档协议：
 * - create 与 update 共用一个端点，靠 `AppMsgId` 是否为空区分（大驼峰，非 appmsgid）
 * - type 固定 77（图文），不是素材类型里的 10
 * - create/update 必须以 multipart/form-data 提交（后台前端对这两个 sub 专门用 FormData + fetch）
 * - 多图文靠下标字段展开：count=N 配 title0/content0/...、title1/content1/...
 * - 这些接口的成功判定是顶层 `ret === '0'`，而非 base_resp.ret
 */

import { H3Event } from 'h3';
import { fetchAndUploadImages, uploadImage } from '~/server/utils/mp-material';
import { type MpWriteContext } from '~/server/utils/mp-ticket';
import { proxyMpRequest } from '~/server/utils/proxy-request';

// 图文类型，取自后台 appmsg.save(isMul, 77, ...) 调用
const APPMSG_TYPE = 77;

// 单次提交的图文条数上限（微信侧限制主图文 + 次条共 8 条）
const MAX_ARTICLES = 8;

export interface DraftArticle {
  title: string;
  content: string;
  author?: string;
  digest?: string;
  // 封面：可传 media_id，或外部图片 URL（URL 会先转存到素材库）
  cover?: string;
  source_url?: string;
  open_comment?: boolean;
  // 仅粉丝可评论
  fans_only_comment?: boolean;
  original?: boolean;
}

export interface SaveDraftResult {
  appMsgId: string;
  // 正文图片转存统计
  images: { uploaded: number; failed: string[] };
}

/**
 * 把一组图文展开为微信要求的下标字段
 *
 * @description 单篇也走同样的结构（count=1 + title0/content0/...）
 */
function buildArticleFields(articles: DraftArticle[], covers: string[]): Record<string, string | number> {
  const fields: Record<string, string | number> = {
    count: articles.length,
  };

  articles.forEach((article, i) => {
    fields[`title${i}`] = article.title;
    fields[`content${i}`] = article.content;
    fields[`author${i}`] = article.author || '';
    fields[`digest${i}`] = article.digest || '';
    fields[`fileid${i}`] = covers[i] || '';
    fields[`sourceurl${i}`] = article.source_url || '';
    fields[`show_cover_pic${i}`] = 0;
    fields[`need_open_comment${i}`] = article.open_comment === false ? 0 : 1;
    fields[`only_fans_can_comment${i}`] = article.fans_only_comment ? 1 : 0;
    // 0=未声明原创，1=声明原创。声明原创需账号有权限，无权限时微信会报错而非静默忽略
    fields[`copyright_type${i}`] = article.original ? 1 : 0;
    fields[`can_reward${i}`] = 0;
  });

  return fields;
}

/**
 * 准备封面：URL 形式先转存到素材库，media_id 直接用
 */
async function prepareCovers(event: H3Event, ctx: MpWriteContext, articles: DraftArticle[]): Promise<string[]> {
  return await Promise.all(
    articles.map(async article => {
      const cover = article.cover?.trim();
      if (!cover) {
        return '';
      }
      // 纯数字视为 media_id，无需转存
      if (/^\d+$/.test(cover)) {
        return cover;
      }
      try {
        const resp = await fetch(cover.startsWith('//') ? `https:${cover}` : cover, {
          headers: { Referer: 'https://mp.weixin.qq.com/' },
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const blob = await resp.blob();
        const uploaded = await uploadImage(event, ctx, blob, 'cover.jpg');
        return uploaded.media_id;
      } catch (err) {
        console.error(`封面转存失败 ${cover}:`, err);
        return '';
      }
    })
  );
}

/**
 * 创建或更新草稿
 *
 * @param appMsgId 传入则为更新，留空则为新建
 */
export async function saveDraft(
  event: H3Event,
  ctx: MpWriteContext,
  articles: DraftArticle[],
  appMsgId?: string,
  // 定时发时间（unix 秒）。微信没有独立的定时发端点，而是在保存草稿时带上此字段
  preTimesendSet?: number
): Promise<SaveDraftResult> {
  if (articles.length === 0) {
    throw new Error('articles 不能为空');
  }
  if (articles.length > MAX_ARTICLES) {
    throw new Error(`一次最多提交 ${MAX_ARTICLES} 篇图文`);
  }
  articles.forEach((article, i) => {
    if (!article.title?.trim()) {
      throw new Error(`第 ${i + 1} 篇缺少 title`);
    }
    if (!article.content?.trim()) {
      throw new Error(`第 ${i + 1} 篇缺少 content`);
    }
  });

  // 正文中的外域图片必须先转存到微信 CDN，否则发布后图片无法显示
  let uploaded = 0;
  const failed: string[] = [];
  const processed = await Promise.all(
    articles.map(async article => {
      const result = await fetchAndUploadImages(event, ctx, article.content);
      uploaded += result.uploaded;
      failed.push(...result.failed);
      return { ...article, content: result.html };
    })
  );

  const covers = await prepareCovers(event, ctx, processed);

  const form = new FormData();
  const fields: Record<string, string | number> = {
    token: ctx.token,
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
    random: Math.random(),
    ticket: ctx.ticket,
    // 空字符串 = 新建，有值 = 更新（后台前端即以此区分 sub=create / sub=update）
    AppMsgId: appMsgId || '',
    isneedsave: 0,
    ...buildArticleFields(processed, covers),
  };
  if (preTimesendSet) {
    fields.pre_timesend_set = 1;
    fields.pre_timesend_time = preTimesendSet;
  }
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value));
  }

  const resp = await proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg',
    query: {
      t: 'ajax-response',
      sub: appMsgId ? 'update' : 'create',
      type: APPMSG_TYPE,
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: form,
    parseJson: true,
  });

  // 这些接口用顶层 ret 表示结果，base_resp 仅在失败时带细节
  const ret = String(resp?.ret ?? resp?.base_resp?.ret ?? '-1');
  if (ret !== '0') {
    const detail = resp?.base_resp?.err_msg || JSON.stringify(resp).slice(0, 300);
    throw new Error(`保存草稿失败 ret=${ret}: ${detail}`);
  }

  const savedId = String(resp?.appMsgId || appMsgId || '');
  if (!savedId) {
    throw new Error(`保存草稿成功但未返回 appMsgId，原始响应 ${JSON.stringify(resp).slice(0, 300)}`);
  }

  return { appMsgId: savedId, images: { uploaded, failed } };
}

/**
 * 删除草稿
 */
export async function deleteDraft(event: H3Event, ctx: MpWriteContext, appMsgId: string) {
  return proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg',
    query: {
      sub: 'del',
      t: 'ajax-response',
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: {
      AppMsgId: appMsgId,
      ticket: ctx.ticket,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });
}

/**
 * 草稿列表
 */
export function listDraft(
  event: H3Event,
  ctx: MpWriteContext,
  options: { begin?: number; count?: number } = {}
) {
  return proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
    query: {
      t: 'media/appmsg_list2',
      action: 'list_card',
      // 草稿列表与创建/编辑一致用 77；传素材类型 10 会返回空 item
      type: APPMSG_TYPE,
      begin: options.begin ?? 0,
      count: options.count ?? 10,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });
}

/**
 * 草稿详情
 *
 * @description 后台没有提供返回 JSON 的详情接口，只能取编辑页 HTML 后从中提取。
 * 正文存在 `content` 字段里且被 HTML 转义，需解码。
 */
export async function getDraft(event: H3Event, ctx: MpWriteContext, appMsgId: string) {
  const html: string = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
    query: {
      t: 'media/appmsg_edit_v2',
      action: 'edit',
      type: APPMSG_TYPE,
      appmsgid: appMsgId,
      token: ctx.token,
      lang: 'zh_CN',
    },
  }).then(resp => resp.text());

  return parseDraftFromEditPage(html, appMsgId);
}

// 编辑页把草稿数据内联为 `var infos = {"item":[...]}`，其中正文字段被 HTML 转义
const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
};

function decodeEntities(text: string): string {
  // &amp; 放在最后替换，避免把 &amp;lt; 提前解成 <
  return text.replace(/&(lt|gt|quot|#39|nbsp);/g, m => HTML_ENTITIES[m]).replace(/&amp;/g, '&');
}

/**
 * 从 `var infos = ` 处按括号配对截取完整 JSON
 *
 * @description 正则难以正确处理嵌套结构与字符串内的括号，这里做一次带字符串状态的扫描
 */
function extractInfosJson(html: string): string | null {
  // 编辑页里 var 与 infos 之间带换行缩进（`var\n    infos = {...}`），不能用固定字符串匹配
  const anchor = html.search(/\bvar\s+infos\s*=/);
  if (anchor === -1) {
    return null;
  }
  const start = html.indexOf('{', anchor);
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 从编辑页 HTML 中提取草稿内容
 */
function parseDraftFromEditPage(html: string, appMsgId: string) {
  const json = extractInfosJson(html);
  if (!json) {
    return { appmsgid: appMsgId, articles: [], raw_found: false };
  }

  try {
    const infos = JSON.parse(json);
    const item = infos?.item?.[0];
    if (!item) {
      return { appmsgid: appMsgId, articles: [], raw_found: false };
    }

    // 多图文的各篇在 multi_item 里；单篇时 multi_item 也有一个元素
    const source = Array.isArray(item.multi_item) && item.multi_item.length > 0 ? item.multi_item : [item];
    const articles = source.map((entry: Record<string, unknown>) => ({
      title: String(entry.title ?? ''),
      author: String(entry.author ?? ''),
      digest: String(entry.digest ?? ''),
      content: decodeEntities(String(entry.content ?? '')),
      cover: String(entry.cover ?? ''),
      source_url: String(entry.source_url ?? ''),
      show_cover_pic: entry.show_cover_pic ?? 0,
      copyright_type: entry.copyright_type ?? 0,
    }));

    return { appmsgid: String(item.app_id ?? appMsgId), articles, raw_found: true };
  } catch (err) {
    console.error('解析草稿编辑页失败:', err);
    return { appmsgid: appMsgId, articles: [], raw_found: false };
  }
}

/**
 * 预览草稿到指定微信号
 *
 * @description 不消耗群发额度，是真发之前最安全的验证手段。
 * @param wxname 接收预览的微信号（需为该公众号的管理员或运营者）
 */
export async function previewDraft(event: H3Event, ctx: MpWriteContext, appMsgId: string, wxname: string) {
  return proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg',
    query: {
      sub: 'preview',
      t: 'ajax-appmsg-preview',
      type: APPMSG_TYPE,
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: {
      appmsgid: appMsgId,
      preusername: wxname,
      preusername_list: JSON.stringify({ preusername: wxname }),
      is_preview: 1,
      only_check: 0,
      ticket: ctx.ticket,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    parseJson: true,
  });
}
