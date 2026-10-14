# workspace-plugin

DeepSeek Harness 的「专家 · 技能 · 连接器」工作台插件。本仓库是该插件的**源码**，
构建后会产出一个合并包 `workspace-plugin`，对外只需要安装这一个包。

## 目录结构

```
packages/workspace-plugin/members/{access,audit,skills,experts,connectors}  成员插件（各自的宿主半边 + 浏览器半边）
packages/workspace-plugin/members/identity-local                         成员插件（工作区身份）
packages/contracts                                        宿主与浏览器共享的类型契约
packages/ui                                               前端组件库 workspace-ui
scripts/build-merged-workspace-plugin.mjs                 合并打包脚本（唯一的构建入口）
scripts/build-{experts,skills,connectors}.mjs             成员的浏览器半边打包
scripts/generate-builtin-skills.mjs                       内置技能（技能创建向导）生成
```

六个成员各自是一个独立的 npm 包（`peerDependencies` 指向官方 `@deepseek-ai/dsh-*` 运行时），
`build-merged-workspace-plugin.mjs` 把它们聚合成一个包：每个成员的入口用 esbuild 打成自包含文件，
各成员的 `cordis.patch.yml` 拼成一份 insert 列表，三个浏览器半边拼成一份 `dist/client.js`
并在末尾追加一个以**包名**注册的聚合入口——这一点是必须的：客户端的模块表只认"裸包名"的行，
子路径行不会被登记成浏览器模块。

## 环境

- Node.js：版本见 `.node-version`
- pnpm：10.x（本仓库用 `corepack pnpm` 亦可）
- 需要能访问 npm registry（依赖是公开包，例如 `@deepseek-ai/dsh-*@0.1.7-rc.2`）

## 构建

```bash
pnpm install
node scripts/build-merged-workspace-plugin.mjs
```

产物在 `packages/workspace-plugin/`，包含：

```
dist/index.js                 以包名注册的宿主入口（承载浏览器声明的那条行）
dist/client.js               浏览器半边（三个成员拼接 + 聚合入口）
dist/<成员>/dist/*.js         各成员的宿主半边
dist/<成员>/resources/**     随包资源（SKILL.md、模板等）
cordis.patch.yml             12 条 insert
package.json                 清单：10 个真实依赖 + 20 个 peerDependencies
```

> **不要执行 `pnpm run build`。** 根 `package.json` 的 `build` / `typecheck` 脚本引用的是
> office、library、projects、activity 等**不在本仓库内**的包，跑起来必然失败。
> 本仓库只有 `node scripts/build-merged-workspace-plugin.mjs` 一个构建入口。

## 产出可分享的自包含 zip

给使用者的 zip 需要**带依赖**，因为客户端"选择目录安装"写的是 `link:` 依赖，
而 `link:` 不会安装被链接包自己的依赖。手工步骤：

```bash
cd packages/workspace-plugin
npm install --omit=dev --legacy-peer-deps   # 只装 dependencies，不拉 peers（peers 由宿主提供）
# 然后把 packages/workspace-plugin 整个目录压成 workspace-plugin-0.1.0.zip
```

使用者解压后，在客户端「插件 → 添加插件」里填**解压出来的那个目录**的绝对路径即可。

## 依赖与运行时边界

- `dependencies`（10）：`fflate`、`yaml`、`zod`、`@deepseek-ai/schemastery`、
  `@deepseek-ai/cordis-plugin-loader`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-experimental-{agent,client-ui,tool}-agent-team`
- `peerDependencies`（20）：整套 `@deepseek-ai/dsh-*` 运行时 + `@deepseek-ai/cordis`，
  **由宿主提供**（桌面客户端自带，或 profile 里的 `dsh-base` / `dsh-web-app`）

声明成 peer 而不是依赖是有意为之：写成依赖会让 pnpm 往 profile 里再装一份被钉死版本的运行时，
并且绕过 dsh-app-boot 只检查 `@deepseek-ai/dsh-*` peer 范围的兼容性校验。

## 本仓库不包含

`node_modules`、`dist`、构建日志、测试运行目录、内部指令文件（AGENTS.md）与任何凭据。
