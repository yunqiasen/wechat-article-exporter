<script setup lang="ts">
// Fork 版提示：上游微信历史文章列表接口已关闭，「同步」当前无法拉取新数据。
// 原文是上游站点 down.mptext.top 的域名到期横幅，与本仓库部署无关，已替换。
const tone = {
  dismissible: true,
  bar: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30',
  icon: 'i-lucide:info',
  iconClass: 'text-amber-500',
  title: 'text-amber-900 dark:text-amber-100',
  body: 'text-amber-800 dark:text-amber-200',
  pill: '',
  cta: 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400',
};

// 仅本次会话生效：关掉后当前标签页内不再弹出，重开标签页会再次提醒。
const dismissed = useSessionStorage('notice:sync-unavailable-2026-09', false);
const visible = computed(() => !(tone.dismissible && dismissed.value));
</script>

<template>
  <div v-if="visible" class="flex flex-shrink-0 items-center gap-4 border-b px-6 py-3" :class="tone.bar">
    <UIcon :name="tone.icon" class="size-5 shrink-0" :class="tone.iconClass" />

    <div class="min-w-0 flex-1">
      <p class="max-w-3xl text-sm font-semibold leading-snug" :class="tone.title">
        历史文章同步已不可用
      </p>
      <p class="max-w-3xl text-sm leading-snug" :class="tone.body">
        上游微信接口已关闭，「同步」当前无法拉取新文章；已同步的文章仍可正常下载与导出。
      </p>
    </div>

    <NuxtLink
      to="/dashboard/article"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors"
      :class="tone.cta"
    >
      <UIcon name="i-lucide:arrow-up-from-line" class="size-4" />
      去导出文章
    </NuxtLink>

    <UTooltip v-if="tone.dismissible" text="本次浏览不再提示（重开标签页会再次提醒）" class="shrink-0">
      <UButton
        square
        variant="link"
        color="gray"
        class="-mr-2"
        aria-label="关闭提示，本次浏览不再显示"
        @click="dismissed = true"
      >
        <UIcon name="i-lucide:x" class="size-5" />
      </UButton>
    </UTooltip>
  </div>
</template>
