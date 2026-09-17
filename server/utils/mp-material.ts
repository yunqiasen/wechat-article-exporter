/**
 * 素材管理（图片上传 / 列表 / 删除 / 正文图片转存）
 */

import * as cheerio from 'cheerio';
import { H3Event } from 'h3';
import PQueue from 'p-queue';
import { USER_AGENT } from '~/config';
import { type MpWriteContext } from '~/server/utils/mp-ticket';
import { proxyMpRequest } from '~/server/utils/proxy-request';

// 正文图片转存的并发数。微信对上传频率敏感，取较小值
const IMAGE_UPLOAD_CONCURRENCY = 3;

// 单张图片大小上限（微信侧限制 10MB）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export interface UploadedImage {
  // 素材 id，用作封面时传给草稿接口的 fileid
  media_id: string;
  // 微信 CDN 地址，用于正文 img src
  cdn_url: string;
}

interface UploadMaterialResponse {
  base_resp?: { ret: number; err_msg?: string };
  content?: string;
  cdn_url?: string;
}

/**
 * 上传图片到素材库
 *
 * @param event
 * @param ctx token + ticket
 * @param file 图片内容
 * @param filename 文件名（微信侧据此判断类型，需带扩展名）
 */
export async function uploadImage(
  event: H3Event,
  ctx: MpWriteContext,
  file: Blob,
  filename: string
): Promise<UploadedImage> {
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error(`图片超过大小上限（${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB）`);
  }

  const form = new FormData();
  form.append('file', file, filename);
  form.append('token', ctx.token);
  form.append('ticket', ctx.ticket);

  const resp: UploadMaterialResponse = await proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/filetransfer',
    query: {
      action: 'upload_material',
      f: 'json',
      scene: 8,
      writetype: 'doublewrite',
      groupid: 1,
      ticket_id: '',
      ticket: ctx.ticket,
      svr_time: Math.floor(Date.now() / 1000),
      token: ctx.token,
      lang: 'zh_CN',
    },
    body: form,
    parseJson: true,
  });

  if (resp.base_resp && resp.base_resp.ret !== 0) {
    throw new Error(`上传图片失败: ${resp.base_resp.ret}:${resp.base_resp.err_msg || ''}`);
  }
  if (!resp.content) {
    throw new Error(`上传图片失败：响应中无 content 字段，原始响应 ${JSON.stringify(resp).slice(0, 300)}`);
  }

  return {
    media_id: resp.content,
    cdn_url: resp.cdn_url || '',
  };
}

/**
 * 素材列表
 *
 * @param type 素材类型：2=图片，3=音频，4=视频，10=图文
 */
export function listMaterial(
  event: H3Event,
  ctx: MpWriteContext,
  options: { type?: number; begin?: number; count?: number } = {}
) {
  return proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/filepage',
    query: {
      type: options.type ?? 2,
      begin: options.begin ?? 0,
      count: options.count ?? 10,
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
      random: Math.random(),
    },
    parseJson: true,
  });
}

/**
 * 删除素材
 * @param fileId 素材的 file_id（非 media_id）
 */
export function deleteMaterial(event: H3Event, ctx: MpWriteContext, fileId: string) {
  return proxyMpRequest({
    event: event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/modifyfile',
    query: {
      t: 'ajax-response',
      token: ctx.token,
      lang: 'zh_CN',
      f: 'json',
    },
    body: {
      oper: 'del',
      fileid: fileId,
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
 * 把正文中的外域图片转存到微信 CDN
 *
 * @description 微信正文只接受自家 CDN 的图片，外链 img 会被剥离或显示失败，
 * 因此发布前必须把非 mp.weixin.qq.com / qpic.cn 域的图片下载后重新上传。
 * @returns 替换后的 HTML 与转存计数
 */
export async function fetchAndUploadImages(
  event: H3Event,
  ctx: MpWriteContext,
  html: string
): Promise<{ html: string; uploaded: number; failed: string[] }> {
  const $ = cheerio.load(html, null, false);

  // 收集需要转存的图片（去重，避免同一张图重复上传）
  const pending = new Map<string, cheerio.Cheerio<any>[]>();
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src')?.trim();
    if (!src || src.startsWith('data:') || isWechatImage(src)) {
      return;
    }
    const group = pending.get(src);
    if (group) {
      group.push($el);
    } else {
      pending.set(src, [$el]);
    }
  });

  if (pending.size === 0) {
    return { html: $.html(), uploaded: 0, failed: [] };
  }

  const queue = new PQueue({ concurrency: IMAGE_UPLOAD_CONCURRENCY });
  const failed: string[] = [];
  let uploaded = 0;

  await Promise.all(
    Array.from(pending.entries()).map(([src, elements]) =>
      queue.add(async () => {
        try {
          const { blob, filename } = await downloadImage(src);
          const result = await uploadImage(event, ctx, blob, filename);
          if (!result.cdn_url) {
            throw new Error('上传成功但未返回 cdn_url');
          }
          elements.forEach($el => $el.attr('src', result.cdn_url));
          uploaded++;
        } catch (err) {
          console.error(`正文图片转存失败 ${src}:`, err);
          failed.push(src);
        }
      })
    )
  );

  return { html: $.html(), uploaded, failed };
}

// 判断是否已是微信自家 CDN 的图片
function isWechatImage(src: string): boolean {
  return /(^https?:)?\/\/([\w-]+\.)*(mp\.weixin\.qq\.com|qpic\.cn|qlogo\.cn)\//.test(src);
}

// 下载外域图片，并从 Content-Type 推断文件名
async function downloadImage(src: string): Promise<{ blob: Blob; filename: string }> {
  const url = src.startsWith('//') ? `https:${src}` : src;

  const resp = await fetch(url, {
    headers: {
      // 部分站点（含微信自身）校验 Referer 防盗链
      Referer: 'https://mp.weixin.qq.com/',
      'User-Agent': USER_AGENT,
    },
  });
  if (!resp.ok) {
    throw new Error(`下载失败 HTTP ${resp.status}`);
  }

  const blob = await resp.blob();
  if (blob.size === 0) {
    throw new Error('下载到空文件');
  }
  if (blob.size > MAX_IMAGE_SIZE) {
    throw new Error(`图片超过大小上限（${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB）`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('gif')
      ? 'gif'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg';

  return { blob, filename: `image.${ext}` };
}
