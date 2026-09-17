/**
 * Nitro KV 兼容写入
 *
 * @description 不同 unstorage 驱动使用不同 TTL 选项名：
 * Cloudflare KV 读取 expirationTtl，Upstash/Vercel KV 读取 ttl。
 * 同时传递二者，驱动只消费自己认识的字段。
 */

export async function setKvWithTtl<T>(key: string, value: T, ttlSeconds: number) {
  await useStorage('kv').set(key, value, {
    ttl: ttlSeconds,
    expirationTtl: ttlSeconds,
  });
}
