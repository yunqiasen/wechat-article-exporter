# 二开维护说明

## 仓库与分支

| 项目 | 约定 |
| --- | --- |
| 本人 Fork / `origin` | https://github.com/yunqiasen/wechat-article-exporter |
| 上游 / `upstream` | https://github.com/wechat-article/wechat-article-exporter |
| `main` | 原版镜像，必须与选定的 `upstream/master` 提交完全一致，只允许快进同步 |
| `wechat-article-exporter-fork` | 默认分支及日常工作分支，所有二开代码、维护文档都提交到这里 |
| 旧 `origin/master`、`origin/dev` | 保留在 `55217d4` 作为兼容与历史引用，不再作为开发入口 |
| `archive/pre-fork-2026-09-17` | 整理前两个旧分支的共同基线标签 |

`main` 不接收二开分支的合并或提交。同步原版和吸收上游改动是两件事：先更新 `main`，再逐项评估是否合入二开分支。

本机仓库使用 `yunqi <200165799+yunqiasen@users.noreply.github.com>` 提交身份，仅设置本仓库，不修改全局身份。默认推送到 `origin`，拉取只允许快进；本机 `upstream` 推送地址设为 `DISABLED`，防止误推原项目。这些本地 Git 配置不会随 clone 自动继承。

## 已保存的二开

2026-09-17 将原本未提交的 38 个文件完整保存为 `09c5cc49e4b1ff3f5bed1a85b6e08be889e8e8ef`，基于上游历史提交 `55217d4fdcefd004d42650ebf15116e7b820967a`。此次整理没有改写这些业务逻辑。

| 范围 | 现有实现 |
| --- | --- |
| 素材与草稿 | 素材上传/列表/删除、正文图片转存；草稿增删改查及预览 |
| 发表 | 发表到发表记录、预检确认、定时操作、额度与记录查询、短期幂等保护；`freepublish` 不群发通知粉丝 |
| 账号网络 | 登录前选择 HTTP(S) 代理，扫码后绑定到账号；自定义 User-Agent 与 Accept-Language |
| 写入保护 | 账号级节流、异常熔断、状态查询与手动重置 |
| 存储适配 | Cloudflare KV 与 Upstash/Vercel KV 的配置、TTL 适配 |

以上是代码实现清单，不是微信线上可用性承诺。没有增加新的第三方项目合并提交；第三方代码来源不能仅凭 Git remote 数量推断。

## 2026-09-17 上游对比

本次实际 fetch 后，上游 `master` 最新为 `a7bffa6e481a188510a701d30b399b76573434e5`，提交时间 2026-08-07。`main` 完整同步到该提交；二开分支尚未合入下表 3 个提交。

| 上游提交 | 更新内容 | 二开处理建议 |
| --- | --- | --- |
| [`26fd877`](https://github.com/wechat-article/wechat-article-exporter/commit/26fd877b08874c36f9e3786d618a85b0cab797d9) · 2026-07-29 | 移除会员购买入口和价格/二维码配置，更新公开站 API 下线提示；保留 API 路由 | 建议吸收付费入口与废弃配置清理。自部署默认关闭会员层，不会因此删除自己的 API；不是同步功能修复 |
| [`47da63e`](https://github.com/wechat-article/wechat-article-exporter/commit/47da63edfd5c7e7aabaf44c96faf88e0f6b8290f) · 2026-07-29 | 上游自身的分支合并，包含当前基线历史 | 历史整理提交，不单独 cherry-pick |
| [`a7bffa6`](https://github.com/wechat-article/wechat-article-exporter/commit/a7bffa6e481a188510a701d30b399b76573434e5) · 2026-08-07 | 停维护说明、历史同步失效提示、移除旧 QQ 群入口、原网站域名到期横幅及配套布局 | 建议按文件/补丁吸收失效说明与旧入口清理；不直接套用 `SiteNotice.vue` 的“本站域名到期”文案和相关布局 |

这 3 个提交没有新增下载引擎、登录协议修复或历史同步替代方案。本轮仅完成比较与记录，没有把它们直接合入二开分支；后续选取改动时保留上游提交来源。

上游作者在 [停止维护说明 #200](https://github.com/wechat-article/wechat-article-exporter/issues/200) 中报告历史文章列表接口关闭，Credential 通道未完整接入主流程。不能将“代码构建成功”“可以出二维码”或“自部署不需要购买会员”视为完整同步链路恢复。接口现状仍需独立实测。

## 日常操作

开发前确认当前分支，不在 `main` 修改代码：

```bash
git switch wechat-article-exporter-fork
git status --short --branch
git pull --ff-only origin wechat-article-exporter-fork
```

修改后按功能提交，推送到同名分支：

```bash
git diff --check
git add <明确要提交的文件>
git diff --cached
git commit -m "feat(fork): describe the change"
git push origin wechat-article-exporter-fork
```

更新原版镜像前先提交或妥善保存二开工作区，禁止用 reset 丢弃改动：

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/master
git push origin main
git switch wechat-article-exporter-fork
git log --oneline wechat-article-exporter-fork..main
git diff wechat-article-exporter-fork...main
```

确认某个非合并提交适用后，可以 `git cherry-pick -x <上游提交>`，保留来源；混有原站运营文案的提交应按补丁筛选，不盲目整包合并。不得把二开反向合到 `main`，不得擅自强推或删除旧远端引用。

## 验证与部署边界

2026-09-17 本机完成以下检查：

- 原有 38 个文件的 SHA-256 在入库前逐项核对，内容完整保留。
- `git diff --check` 通过；`main` 与最新 `upstream/master` 无差异。
- Node 22.21.1 / Yarn 1.22.22 下，`NITRO_PRESET=node-server yarn build` 成功。
- 临时本地生产进程通过 6 项 HTTP 冒烟检查：Dashboard 返回 200；无登录态的草稿、素材、额度、发表接口拒绝操作；账号网络配置返回 401。测试进程随后退出，没有使用微信凭据或执行真实发表。

本轮没有验证 CF Workers 构建/运行、Vercel 部署、微信扫码登录、历史文章同步或真实写操作，也没有进行云端部署。构建与匿名接口检查不等于这些功能已上线可用。

`wrangler.toml`、GitHub 部署工作流和 Docker 镜像命名仍含上游模板信息。部署前必须单独核对本人的 Worker/KV/域名/镜像命名与出口代理兼容性，不要把 `down.mptext.top` 或 `ghcr.io/wechat-article/...` 当成本人的资源。已有部署工作流仅在推送 `master` 或手动触发时执行，推送本次两个新分支不会自动部署。

本机整理前的 Git bundle、工作区补丁、新文件归档与校验清单位于项目同级的 `.wechat-article-exporter-backup-20260917-BYrao2`，不提交到公开仓库。`.env`、登录态、代理凭据、构建产物均保持 Git 忽略。
