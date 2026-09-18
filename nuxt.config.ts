// Vercel Marketplace 连接 Upstash 后会自动注入 UPSTASH_REDIS_REST_*；无需再手填 driver。
// 显式 NITRO_KV_DRIVER 始终优先，确保本地 fs / Cloudflare binding 原逻辑不变。
const kvDriver =
  process.env.NITRO_KV_DRIVER ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? 'upstash'
    : process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
      ? 'vercel-kv'
      : 'memory');

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-10-30',
  devtools: {
    enabled: false,
  },
  modules: ['@vueuse/nuxt', '@nuxt/ui', 'nuxt-monaco-editor', 'nuxt-umami'],
  ssr: false,
  runtimeConfig: {
    public: {
      aggridLicense: process.env.NUXT_AGGRID_LICENSE,
      // 公开托管站标记（仅公开托管用；默认关闭，fork 私有部署无限速、无下线提示）
      // 开启后：公开 API 按游客/会员分层限速，文档页展示限速说明与 API 下线提示
      membership: {
        enabled: process.env.NUXT_PUBLIC_MEMBERSHIP_ENABLED === 'true',
      },
    },
    debugMpRequest: false,
  },
  app: {
    head: {
      meta: [
        {
          name: 'referrer',
          content: 'no-referrer',
        },
      ],
      script: [
        {
          src: '/vendors/html-docx-js@0.3.1/html-docx.js',
          defer: true,
        },
      ],
    },
  },
  sourcemap: {
    client: 'hidden',
  },
  nitro: {
    minify: process.env.NODE_ENV === 'production',
    // 开启 wasm 支持（unwasm）：cgi 沙箱 @cf-wasm/quickjs 以 import 方式引入 .wasm 模块，
    // 需要该插件处理（含 edge/CF 约定的 `.wasm?module` 后缀），否则 rollup 无法加载 wasm。
    experimental: {
      wasm: true,
    },
    rollupConfig: {
      external: ['puppeteer'],
    },
    storage: {
      kv: {
        driver: kvDriver,
        // cloudflare-kv-binding 驱动使用；Workers 部署时对应 wrangler.toml 中的 KV 绑定名。
        // fs / memory 驱动会忽略该选项，因此对 Docker / 本地 dev 无影响。
        binding: 'KV',
        // Vercel Serverless 必须使用持久化存储；memory 驱动会因函数实例切换而丢失登录态、代理绑定与风控状态。
        // 推荐在 Vercel Marketplace 添加 Upstash Redis，并设置 NITRO_KV_DRIVER=upstash。
        url:
          kvDriver === 'upstash'
            ? process.env.UPSTASH_REDIS_REST_URL
            : kvDriver === 'vercel-kv'
              ? process.env.KV_REST_API_URL
              : undefined,
        token:
          kvDriver === 'upstash'
            ? process.env.UPSTASH_REDIS_REST_TOKEN
            : kvDriver === 'vercel-kv'
              ? process.env.KV_REST_API_TOKEN
              : undefined,
        // base 对 fs 驱动是存储目录(.data/kv)；但对 cloudflare-kv-binding 会变成键前缀，
        // 导致读到 `.data/kv:member:xxx` 而非 `member:xxx` → 键不匹配。故 CF 下不加 base。
        base: process.env.NITRO_KV_DRIVER === 'cloudflare-kv-binding' ? undefined : process.env.NITRO_KV_BASE,
      },
    },
  },
  monacoEditor: {
    locale: 'en',
    componentName: {
      codeEditor: 'MonacoEditor', // 普通编辑器组件名
      diffEditor: 'MonacoDiffEditor', // 差异编辑器组件名
    },
  },

  // https://umami.nuxt.dev/api/configuration
  umami: {
    enabled: true,
    id: process.env.NUXT_UMAMI_ID,
    host: process.env.NUXT_UMAMI_HOST,
    domains: ['down.mptext.top'],
    ignoreLocalhost: true,
    autoTrack: true,
    logErrors: true,
  },
});
