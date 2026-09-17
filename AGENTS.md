# Fork Maintenance

- Read `FORK.md` before making changes.
- Work on `wechat-article-exporter-fork`. This is the default development branch.
- Keep `main` an exact mirror of `upstream/master`. Only fast-forward it; do not commit fork changes or merge the fork into it.
- Push changes to `origin` (`yunqiasen/wechat-article-exporter`), never to `upstream` (`wechat-article/wechat-article-exporter`).
- Keep upstream updates separate from fork feature commits. Review each update and retain its source when cherry-picking.
- Do not force-push, delete historical refs, or discard uncommitted work without explicit approval.
- Preserve the upstream MIT license and author attribution.
- Keep secrets, login data, proxy credentials, and generated build output out of Git.
- Repository maintenance does not authorize cloud deployment or live WeChat publication.
- A successful build or QR login is not proof that historical synchronization or publishing works. Report the exact verification scope.

## Checks

- Use Node >= 22 and Yarn 1.22.22 with the existing lockfile.
- Run `git diff --check` before committing.
- Run `NITRO_PRESET=node-server yarn build` for changes affecting the application.
- Do not claim CF Workers or Vercel support is verified without testing the target runtime.
