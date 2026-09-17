import dayjs from 'dayjs';
import { H3Event, parseCookies } from 'h3';
import { v4 as uuidv4 } from 'uuid';
import { isDev, USER_AGENT } from '~/config';
import { RequestOptions } from '~/server/types';
import { cookieStore, getCookieFromStore } from '~/server/utils/CookieStore';
import { logRequest, logResponse } from '~/server/utils/logger';
import {
  createMpDispatcher,
  getLoginNetworkProfile,
  getMpNetworkProfile,
  persistLoginNetworkProfile,
} from '~/server/utils/mp-network-profile';

/**
 * 代理微信公众号请求
 * @description 备注：只有登录请求(`action=login`)中的 `set-cookie` 才会被写入到 CookieStore 中
 * @param options 请求参数
 */
export async function proxyMpRequest(options: RequestOptions) {
  const authKey = getAuthKeyFromRequest(options.event);
  // 登录阶段尚无 authKey：使用客户端随扫码会话传来的临时配置；登录后改从 KV 按 authKey 读取。
  const networkProfile = authKey
    ? await getMpNetworkProfile(authKey)
    : options.action === 'start_login' || options.action === 'login' || options.endpoint.includes('/scanloginqrcode')
      ? await getLoginNetworkProfile(options.event)
      : null;

  const headers = new Headers({
    Referer: options.referer || 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
    'User-Agent': networkProfile?.enabled ? networkProfile.userAgent : USER_AGENT,
    'Accept-Language': networkProfile?.enabled ? networkProfile.acceptLanguage : 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'identity', // 禁用压缩，避免出现response.clone() bug
  });

  // 优先读取参数中的 cookie，若无则从 CookieStore 中读取
  const cookie: string | null = options.cookie || (await getCookieFromStore(options.event));
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  const requestInit: RequestInit = {
    method: options.method,
    headers: headers,
    redirect: options.redirect || 'follow',
  };

  // 处理参数
  if (options.query) {
    options.endpoint += '?' + new URLSearchParams(options.query as Record<string, string>).toString();
  }
  if (options.method === 'POST' && options.body) {
    // FormData 原样透传，不设置 Content-Type，由 fetch 自动带 multipart boundary
    requestInit.body =
      options.body instanceof FormData
        ? options.body
        : new URLSearchParams(options.body as Record<string, string>).toString();
  }

  // 构造请求
  const request = new Request(options.endpoint, requestInit);

  // 记录请求报文
  const requestId = uuidv4().replace(/-/g, '');
  if (process.env.NUXT_DEBUG_MP_REQUEST && isDev) {
    await logRequest(requestId, request.clone());
  }

  // 转发请求。配置了账号代理时仅在 Node/Vercel runtime 注入 undici dispatcher；
  // 未配置的账号仍走原生 fetch，原项目行为不变。
  const dispatcher = await createMpDispatcher(networkProfile);
  const mpResponse = await fetch(request, dispatcher ? ({ dispatcher } as RequestInit) : undefined);

  // 记录响应报文
  if (process.env.NUXT_DEBUG_MP_REQUEST && isDev) {
    await logResponse(requestId, mpResponse.clone());
  }

  let setCookies: string[] = [];

  // 处理登录请求的 uuid cookie
  if (options.action === 'start_login') {
    // 提取出 uuid 这个 cookie，并透传给客户端
    setCookies = mpResponse.headers.getSetCookie().filter(cookie => cookie.startsWith('uuid='));
  }

  // 处理登录成功请求的 cookie
  // 只有登录请求才会将 Cookie 数据写入 CookieStore
  // 返回给客户端的一个 auth-key 的 cookie
  else if (options.action === 'login') {
    // 提取出 token 和 cookies
    try {
      const authKey = crypto.randomUUID().replace(/-/g, '');

      const body = await mpResponse.clone().json();
      const redirectUrl = body?.redirect_url;
      if (!redirectUrl || typeof redirectUrl !== 'string') {
        throw new Error(`登录响应中未找到 redirect_url，响应内容: ${JSON.stringify(body)}`);
      }

      const token = new URL(`http://localhost${redirectUrl}`).searchParams.get('token');
      if (!token) {
        throw new Error(`redirect_url 中未找到 token 参数: ${redirectUrl}`);
      }

      console.log('token', token);
      const success = await cookieStore.setCookie(authKey, token, mpResponse.headers.getSetCookie());
      if (!success) {
        throw new Error('cookie 写入 KV 存储失败');
      }

      // 扫码阶段使用的代理/请求头必须继续绑定到这个 authKey，避免登录后突然更换出口 IP。
      await persistLoginNetworkProfile(options.event, authKey);
      console.log('cookie 写入成功');

      setCookies = [
        `auth-key=${authKey}; Path=/; Expires=${dayjs().add(4, 'days').toString()}; Secure; HttpOnly`,

        // 登录成功后，删除浏览器的 uuid cookie
        `uuid=EXPIRED; Path=/; Expires=${dayjs().subtract(1, 'days').toString()}; Secure; HttpOnly`,
      ];
    } catch (error) {
      console.error('action(login) failed:', error);

      // 登录失败时返回错误响应，而不是静默继续
      return new Response(JSON.stringify({ base_resp: { ret: -1, err_msg: `登录处理失败: ${error}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 处理切换公众号的请求
  else if (options.action === 'switch_account') {
    const authKey = getAuthKeyFromRequest(options.event);
    if (authKey) {
      setCookies = ['switch_account=1'];
    }
  }

  // 这里是否需要执行？
  // 更新 CookieStore 中的 cookie
  else {
    // updateCookies(options.event, mpResponse.headers.getSetCookie());
  }

  // 构造返回给客户端的响应
  const responseHeaders = new Headers(mpResponse.headers);
  responseHeaders.delete('set-cookie');
  setCookies.forEach(setCookie => {
    responseHeaders.append('set-cookie', setCookie);
  });

  const finalResponse = new Response(mpResponse.body, {
    status: mpResponse.status,
    statusText: mpResponse.statusText,
    headers: responseHeaders,
  });

  if (!options.parseJson) {
    return finalResponse;
  }

  const body = await finalResponse.json();

  // 仅对已有 authKey 的微信 POST 响应记录风控信号。
  // 动态导入避免 proxy-request 与 mp-risk 形成模块循环；读取接口和登录过程不受影响。
  if (options.method === 'POST' && getAuthKeyFromRequest(options.event)) {
    const { afterMpWrite } = await import('~/server/utils/mp-risk');
    await afterMpWrite(getAuthKeyFromRequest(options.event), body);
  }

  return body;
}

export function getAuthKeyFromRequest(event: H3Event): string {
  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (!authKey) {
    const cookies = parseCookies(event);
    authKey = cookies['auth-key'];
  }

  return authKey;
}

// function updateCookies(event: H3Event, cookies: string[]): void {
//   const authKey = getAuthKeyFromRequest(event);
//   if (authKey) {
//     cookieStore.updateCookie(authKey, cookies);
//   }
// }
