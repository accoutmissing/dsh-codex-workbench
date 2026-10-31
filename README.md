**简体中文** · [English](README.en.md)

# 派活台 · dsh-codex-workbench

给 DeepSeek Harness（DSH）加一块「派活台」：**把每一次派给 Codex 的活列成一列**——工作目录、任务原话、已经跑了多久、烧掉多少 token、现在什么状态、这次产出了哪些文件。

它以两种形态出现：右下角的浮卡，和右栏里一个同名标签页。两者读同一份数据。

```
派活台                        已扫 232 个 rollout · +208        收起
┌──────────────────────────────────────────────────────────────┐
│ ● D:\Fun          派活                                    2m  │
│   GIMP / Inkscape / Krita 去掉,换成 artcraft 里面的 …         │
│   229.8M↓ 223.0Mc 690k↑  wait_agent  gpt-6.1-terra           │
│ ◉ D:\Fun          审查                                   <1m  │
│   The following is the Codex agent history added since …     │
│ ● D:\Fun          子代理                                  <1m  │
│   5.1M↓ 4.9Mc 16k↑  send_message                              │
│ ○ D:\Fun          派活                                   3h前  │
│   你结合最近我的工作来实际分析                                 │
│   356k↓ 320kc 2k↑  wait_agent  gpt-6.1-sol                   │
└──────────────────────────────────────────────────────────────┘
```

## 为什么需要它

派活给 Codex 是一次「异步投递」：命令返回了，活还在跑；界面里没有它的会话，只有另一个进程。于是「它现在到哪一步了」这个问题，只能靠人一遍遍去翻 `~/.codex/sessions` 里的文件时间戳，或者在对话里手动三态汇报。

这个插件把那份记录读成一张表：哪次派活、在哪个目录、跑了多久、花了多少、产出了什么。判据很简单——**只要能一眼看出「还在跑 / 卡住了 / 已经完事」**，人工巡查这件事就消失了。

## 两个入口

| 入口 | 座位 | 说明 |
| --- | --- | --- |
| 右下角浮卡 | `shell.overlay` | 收起时是一枚药丸「派活台 · N 在跑」，点开展开卡片；有活在跑时自动展开；药丸可拖动，卡片贴着它长出来 |
| 右栏标签页 | `sidebar.right.pane.tab` + `.title` | 全量列表（不截断）+ 四个筛选标签：全部 / 派活 / 审查 / 子代理 |

- 每次展开都记住：手动收起之后就不再自作主张地弹开（状态存在 `localStorage`）。
- 药丸的位置也记住（存的是**左上角坐标**，不是距右下角的偏移——窗口变小时偏移会把药丸推到屏幕外）。
- 展开后药丸**留在原位**并变成「收起」：出去的门口就是进来的门口，关掉不用去卡片里找按钮。
- 行内展开看这次派活的任务原文、工作目录、最后一段回复，以及产物文件（按 mtime 倒序）。
- 页面加载的 client bundle 比磁盘旧时，头部会出现一条「界面代码已更新 · 点此刷新」，点一下重载，不用猜是不是没生效。

## 数据从哪来

全部来自 Codex 自己写的 rollout 日志，插件只读不写。

| 事实 | 细节 |
| --- | --- |
| 位置 | `%USERPROFILE%\.codex\sessions\<YYYY>\<MM>\<DD>\rollout-*.jsonl`（`CODEX_HOME` 存在时用它） |
| 读取策略 | 只读文件**尾部 512 KB**（一次派活可能写到几十 MB）；`session_meta` 首行含整份 base prompt，按 8 KB → 256 KB → 1 MB 逐级放大，读到行尾就缓存 |
| 任务原话 | `item_completed` 里 `item.type === "UserMessage"` 的文本——即你自己敲的那句话，不是系统提示 |
| 用量 | `token_count` 事件的 `info.total_token_usage`：`input` / `cached` / `output` |
| 分类 | `session_meta.thread_source`：`user`（真派活）/ `guardian_review`（自动审查）/ `subagent`（子代理），排序时依次靠后，免得审查把真派活挤出屏幕 |
| 状态 | `running`（最近 10 分钟内有事件且最后一轮未结束）/ `done`（最后一轮已 `task_complete`）/ `stale`（有未完成回合但已静默超过 10 分钟，多半是卡住或进程没了） |
| 时间列 | 运行中显示**已跑时长**（`activeMs`），其余显示**闲置多久**（距最后一个事件）——两者都不是会话文件的创建时间，跨天续用的线程不会显示成「已跑 14246 分钟」 |
| 实测规模 | 本机 232 个 rollout 文件、按 3 天窗口留下 24 条；全量扫描 ~1.4 s，命中缓存后 ~0.2 s |

按 `size + mtime` 增量：没变过的文件不重读。扫描在后台单飞（同一时刻只跑一次），路由先返回缓存再触发刷新。

## 交互

| 操作 | 结果 |
| --- | --- |
| 点浮卡药丸 | 展开 / 收起卡片 |
| 拖动浮卡药丸 | 在窗口内移动；卡片跟着走，松手才落盘 |
| 点行 | 展开 / 收起这次派活的详情 |
| 右栏筛选标签 | 按 `thread_source` 过滤，括号里是条数 |
| 展开态的药丸（显示「收起」） | 收起卡片，落回药丸原来那个位置 |
| 「界面代码已更新」条 | 重载页面以拉取新的 client bundle |

## 路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/plugins/codex-workbench/state` | GET | 会话列表 + 扫描统计 + client 版本戳 + 插件版本 |
| `/plugins/codex-workbench/files?id=<sessionId>` | GET | 单次派活的产物文件（BFS 深度 3，跳过 `node_modules` 等） |

两条路由都**只接受 loopback 请求**，非 GET 一律 405。插件不发起任何外部网络请求，`dependencies` / `devDependencies` / `peerDependencies` 全空。

## 设计语言

配色与动效跟随当前皮肤（本机是 `dsh-claude-style`），不自带调色板：

- 颜色只走宿主/皮肤 token（`--dsw-alias-*`、`--dsh-tone-*`、`--dsh-claude-*`），**每个 token 都带 fallback**——皮肤被关掉也不会塌成一堆黑字。
- 分隔线 0.5px，圆角取 4 / 6 / 8 / 12 / 16 / 999 梯子，focus 用宿主 `--dsw-focus-ring-color` 而不是强调色。
- 动效只用皮肤的时长与曲线 token：卡片进场 `ease-enter`，行错峰进场（每组 8 行，间隔 `duration-instant / 8`），运行中的状态点用 `duration-fade × 8` 的呼吸环；`prefers-reduced-motion` 下全部关掉。
- **状态不只靠颜色**：运行中是实心强调色 + 呼吸环，已结束是灰色实心，卡住是**空心环**——陶土色与琥珀色在 6px 尺寸上太接近，所以形状也参与编码。
- **面板始终不透明**：表面色取 `--dsh-claude-card`，并且是铺在一层不透明底色（`--dsw-alias-bg-base`）之上——即使皮肤给出半透明表面，浮卡也不会变成一扇窗。没有 `backdrop-filter`。
- 浮卡与胶囊在宿主浮层里是**平级兄弟**，只按 `z-index` 排序：本机实测相邻插件用到 10000，所以层级取皮肤的 `--dsh-claude-layer-float`（`99999`）；这不会盖住宿主的对话框（对话框在另一层，1000–1100）。注意 `--dsh-claude-layer-*` 全族都是**层号**，不是颜色——把它当背景色用会让整条声明失效。

## 安装

这是一个 DSH bundle（`dsh.bundle.patch` 指向 `cordis.patch.yml`），装法与其它本地 bundle 相同：

```js
// 在 DSH 会话里让 Agent 执行
plugin_manager({ action: 'install_bundle',
                 target: 'D:\\路径\\到\\dsh-codex-workbench' })
```

- 返回 `application: "applied"` 才算生效；`failed` 时看 `warnings`。
- 安装后**刷新页面**（Ctrl+R）才会挂上新的 client bundle。
- 改了插件代码不重启也会生效：`plugin_manager({ action:'set_plugin', target:'include:dsh-codex-workbench', enabled:false })` 再 `enabled:true`（entry id 不是包名）。
- 自检：`GET /plugins/codex-workbench/state` 里 `version` 是你刚写进 `package.json` 的版本；`staleHost` 为 `false`、且 `hostStamp` 不大于 `loadedAt`，才说明宿主模块是这份文件；`clientStamp` 与 `client.js` 的 mtime 一致，才说明浏览器那半也换新了。

## 兼容性与已知限制

- 只在 **Windows + DSH 桌面版**上实测过（Electron 自带 Node 24）。
- 只解析 rollout 里**结构化**的事件；`ops_bash` 命令字符串里隐藏的产物不猜。
- 窗口固定为最近 3 天、最多 24 条。更久的历史不读，因为「现在在跑什么」才是这个面板要回答的问题。
- 状态靠「静默时长」推断，没有进程级探活：一个 9 分钟没输出的活仍会显示 `running`。这是有意选的保守解——把还在跑的活误判成死了，比多留一会儿更糟。

## 开发

没有构建步骤。`index.js` 是宿主半部（扫描 rollout、折叠事件、注册路由），`client.js` 是浏览器半部（浮卡 + 右栏标签）。

```bash
node --check index.js && node --check client.js
```

改 UI 时注意：这个插件不自带配色方案，它读皮肤的 token。原始时间值只允许出现在 token 的 fallback 里。

## 许可

MIT，见 [LICENSE](LICENSE)。
