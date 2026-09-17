/**
 * 正式入口：发表到“发表记录”（不群发通知粉丝）
 *
 * @description 为避免与旧 `/publish/send` 的历史命名混淆，本路由名称明确使用 freepublish。
 * 内部转发给兼容入口，两者行为完全一致。
 */

export { default } from './send.post';
