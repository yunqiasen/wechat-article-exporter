<script setup lang="ts">
import { request } from '#shared/utils/request';
import type { LoginAccount, ScanLoginResult, StartLoginResult } from '~/types/types';

const modal = useModal();

const qrcodeSrc = ref('');
const loading = ref(false);
const msg = ref('');

// 登录前选定网络配置，确保开始登录、二维码、轮询和最终登录始终走同一出口。
// 用 sessionStorage 而非 localStorage，避免代理凭据长期留在浏览器。
const proxyUrl = useSessionStorage('mp-login:proxy-url', '');
const proxyUserAgent = useSessionStorage(
  'mp-login:user-agent',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
);
const proxyAcceptLanguage = useSessionStorage('mp-login:accept-language', 'zh-CN,zh;q=0.9');
const networkSessionId = ref('');
const showNetworkSettings = ref(false);

function loginNetworkHeaders(): Record<string, string> {
  return networkSessionId.value ? { 'X-Mp-Network-Session': networkSessionId.value } : {};
}

async function createNetworkSession() {
  if (!proxyUrl.value.trim()) {
    networkSessionId.value = '';
    return;
  }

  const resp = await request<{ base_resp: { ret: number; err_msg: string }; session_id?: string }>(
    '/api/public/v1/network/login-session',
    {
      method: 'POST',
      body: {
        proxyUrl: proxyUrl.value.trim(),
        userAgent: proxyUserAgent.value.trim(),
        acceptLanguage: proxyAcceptLanguage.value.trim(),
        enabled: true,
      },
    }
  );
  if (resp.base_resp.ret !== 0 || !resp.session_id) {
    throw new Error(resp.base_resp.err_msg || '创建网络会话失败');
  }
  networkSessionId.value = resp.session_id;
}

function setQrcodeSrc(src: string) {
  if (qrcodeSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(qrcodeSrc.value);
  }
  qrcodeSrc.value = src;
}

async function loadQrcodeImage() {
  const resp = await fetch(`/api/web/login/getqrcode?rnd=${Math.random()}`, {
    credentials: 'same-origin',
    headers: loginNetworkHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`获取二维码失败: HTTP ${resp.status}`);
  }
  setQrcodeSrc(URL.createObjectURL(await resp.blob()));
}

const checkTimer = ref<number | null>(null);

const loginAccount = useLoginAccount();

onMounted(async () => {
  try {
    if (proxyUrl.value.trim()) {
      await createNetworkSession();
    }
    await getQrcode();
  } catch (e: any) {
    msg.value = e.message;
  }
});

function closeModal() {
  modal.close();
  setQrcodeSrc('');

  window.clearTimeout(checkTimer.value!);
  checkTimer.value = null;
}

/**
 * 创建新的登录会话
 *
 * 该请求会在response中设置一个唯一的uuid(cookie)作为会话id
 */
async function newLoginSession() {
  const sid = new Date().getTime().toString() + Math.floor(Math.random() * 100);
  const resp = await request<StartLoginResult>(`/api/web/login/session/${sid}`, {
    method: 'POST',
    headers: loginNetworkHeaders(),
  });
  if (!resp || !resp.base_resp || resp.base_resp.ret !== 0) {
    throw new Error(`${resp?.base_resp?.err_msg || '获取登录会话失败'}`);
  }
}

// 获取登录二维码
async function getQrcode() {
  try {
    loading.value = true;
    msg.value = '获取登录二维码';
    await newLoginSession();
    await loadQrcodeImage();
    msg.value = '';

    // 启动计时器开始轮训检查
    _check();
  } catch (e: any) {
    msg.value = e.message;
    qrcodeSrc.value = 'https://placehold.co/320?text=qrcode';
  } finally {
    loading.value = false;
  }
}

function _check() {
  window.clearTimeout(checkTimer.value!);

  if (modal.isOpen.value) {
    checkTimer.value = window.setTimeout(checkQrcodeStatus, 2000);
  }
}

// 检查二维码扫描状态
async function checkQrcodeStatus() {
  const resp = await request<ScanLoginResult>('/api/web/login/scan', {
    headers: loginNetworkHeaders(),
  });
  if (resp && resp.base_resp && resp.base_resp.ret === 0) {
    switch (resp.status) {
      case 0:
        _check();
        break;
      case 1:
        // 登录成功
        msg.value = '已确认，正在登录中';
        await bizLogin();
        break;
      case 2:
      case 3:
        // 刷新二维码，仍使用当前登录会话的同一代理
        await loadQrcodeImage();
        _check();
        break;
      case 4:
      case 6:
        if (resp.acct_size >= 1) {
          loading.value = true;
          msg.value = '扫码成功，等待确认';
          qrcodeSrc.value = '';
        } else {
          msg.value = '没有可登录账号';
        }
        _check();
        break;
      case 5:
        // 未绑定邮箱，不能扫描登录
        msg.value = '该账号尚未绑定邮箱';
        _check();
        break;
    }
  }
}

async function applyNetworkSettings() {
  // 代理凭据只提交一次，后续扫码链路只携带短期 sessionId。
  await createNetworkSession();
  setQrcodeSrc('');
  await getQrcode();
}

async function bizLogin() {
  try {
    loading.value = true;
    const resp = await request<LoginAccount>('/api/web/login/bizlogin', {
      method: 'POST',
      headers: loginNetworkHeaders(),
    });
    if (resp.err) {
      throw new Error(`${resp.err}`);
    }

    msg.value = '登录成功';
    loginAccount.value = resp;

    closeModal();
  } catch (e: any) {
    msg.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal prevent-close>
    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">登录微信公众号</h2>
        <UButton
          square
          variant="link"
          color="gray"
          icon="i-lucide:x"
          class="absolute right-3 top-3"
          @click="closeModal"
        />
      </template>

      <div class="flex flex-col justify-center items-center mx-auto size-80">
        <UIcon v-if="loading" name="i-lucide:loader" :size="28" class="animate-spin text-slate-500" />
        <p v-if="msg" class="text-rose-500">{{ msg }}</p>
        <img v-if="qrcodeSrc" :src="qrcodeSrc" alt="" class="w-full rounded-md" />
      </div>

      <div class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <UButton
          variant="link"
          color="gray"
          :icon="showNetworkSettings ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'"
          label="网络出口（可选）"
          @click="showNetworkSettings = !showNetworkSettings"
        />
        <div v-if="showNetworkSettings" class="mt-2 grid gap-3">
          <UFormGroup label="HTTP/HTTPS 代理" hint="登录与后续操作会绑定同一出口；留空使用 Vercel 默认出口">
            <UInput v-model="proxyUrl" placeholder="http://user:pass@host:port" autocomplete="off" />
          </UFormGroup>
          <UFormGroup label="User-Agent">
            <UInput v-model="proxyUserAgent" />
          </UFormGroup>
          <UFormGroup label="Accept-Language">
            <UInput v-model="proxyAcceptLanguage" />
          </UFormGroup>
          <p class="text-xs text-amber-600 dark:text-amber-400">
            代理配置仅保存在当前浏览器会话；登录成功后绑定到该公众号。代理不可用会导致二维码加载失败。
          </p>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide:refresh-cw"
            label="应用网络设置并重新生成二维码"
            :loading="loading"
            @click="applyNetworkSettings"
          />
        </div>
      </div>
    </UCard>
  </UModal>
</template>
