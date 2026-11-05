# Changelog

Why each version exists, not just what changed.

## 0.4.2 — 2026-11-05

**宿主升到 0.2.2-rc.1 后做了一轮兼容性复核：代码不用改，但清单该说的话要说上。**

DSH 在**加载插件之前**就评估 `engines.dsh`（`dsh-app-boot` 里的 `evaluatePluginCompatibility`），不满足时连 import 都不会发生。没写这一条的插件在旧宿主上碰巧能用，但升级到不兼容的运行时就会毫无提示地消失——上一版补上了这条声明，这一版把它抬成正式版本，免得「tag 指向的清单」和仓库里真正跑的清单是两份东西。

- **0.2.2-rc.1 实测全部照常工作**：`/plugins/codex-workbench/state` 返回 200，`scanned:131 / skipped:107`，会话条目带真实 `path` 与 `name`；`client.graphRev` 有值、`staleHost:false`；右栏标签 `codex-workbench` 在 `sidebar.right.pane.tab` 上 active。
- **范围没动**：`>=0.2.0-rc.1 <0.3.0-0` 已经覆盖 0.2.2-rc.1。声明的作用是「不兼容时明确拒绝」，不是「把上限顶到最新」——把没测过的版本写进范围才是真正的风险。

## 0.4.1 — 2026-10-31

胶囊本来能拖，但一旦拖进窗口最上面那一条，就再也抓不起来了——鼠标按下去是拖窗口，不是拖胶囊。

- **那一条不是我们的画布。** 带自定义标题栏的窗口会在顶部铺一条 `-webkit-app-region: drag` 的系统拖动条（高度就是 `--dsh-windows-titlebar-height`，运行时写在 `documentElement` 上的内联值，40px）。落在里面的浮层收不到 pointer 事件——窗口先把按下吃掉了，所以它看起来好好的，只是点不动。
- **壳自己的浮层也是这么躲的。** 它的定位夹取是 `Math.max(y, 标题栏高度 + 20)`，全屏不保留——这里照抄这个界，而不是自己发明一个数字。
- **夹取之外再加一道保险。** 胶囊和卡片都写了 `-webkit-app-region: no-drag`：已经存在 localStorage 里、卡在上面的旧坐标也能被抓住拖出来。
- **进页面就自愈一次。** 挂载时立刻跑一遍夹取，把旧版本存下来的非法坐标拉回合法位置并回写，而不是等人手动拖。
- **旧位置不会把人卡死。** 夹取只在拖动与挂载时发生，`x` 完全不动——只修那条不该待的横带。

## 0.4.0 — 2026-10-31

**The panel lived in a corner, so moving it was impossible and closing it meant hunting.**

Two things were asked for, in this order: make the pill draggable and open the card next to it; then make collapsing land back on the pill's own spot.

- **The pill is the handle.** It is dragged with pointer capture, moved in the viewport's top-left coordinate space (not as an offset from the bottom-right corner — an offset drifts off-screen when the window shrinks, a point does not), clamped inside an 8px margin, and the position is written to `localStorage` **on release only**. Writing on every pointer move would put a disk write inside the drag loop.
- **The card is anchored to the pill, not to the corner.** It opens away from the nearest edges (up when the pill is in the lower half, down otherwise; left/right likewise), and `transform-origin` follows the direction so the card grows out of the pill instead of materialising next to it.
- **The pill stays mounted while the card is open and turns into the collapse control in place.** That is the whole point of the second request: the way back out is where you came in. The card lost its own 收起 button as a result — one control, in the place the hand already went.
- A drag ends with a click on the same element, and React state updates are batched, so "was this a drag or a click?" is held in a **ref**, not state. Reading a state flag in `pointerup` gives the value from the previous render, which made a dragged pill spring open and skip the position write.
- Dragging while open keeps working: the card follows, because placement is derived from the measured pill rect on every render.

Verification is mechanical, since the app could not be driven directly (`dsh web` refuses the bare host without its printed URL): `placement-test.mjs` (18 assertions on the pure geometry), `drag-test.mjs` (36 assertions on the gesture, persistence, and the pill-as-collapse behaviour), `render-test.mjs`, the 46-assertion style audit, and a static preview rendered from the production bundle.

## 0.3.2 — 2026-10-31

**The panel was see-through, and the cause was one token used as the wrong kind of value.**

The card painted itself with `background: var(--dsh-claude-layer-float, …)`. That token is **`99999` — a z-index**, not a colour. Because the token *exists*, the fallback never applied, `99999` is not a valid `<color>`, and the whole declaration was dropped. Measured in the browser: that exact expression computes to `rgba(0, 0, 0, 0)`. Nothing was "set to a low opacity" — there was no background at all, so every row behind the panel showed through.

Two things were wrong at once, and they had the same origin: I had assumed the `--dsh-claude-layer-*` family were surfaces, and picked the float one for both the surface colour and the stacking order. The family is entirely stacking levels (`chrome 30`, `control 10`, `float 99999`, `peek 40`, `picker 20`, `takeover 2147483000`); the surfaces are `--dsh-claude-card` / `--dsh-claude-canvas` / `--dsh-claude-chip`.

So:

- Surface now comes from `--dsh-claude-card`, and it is painted **over an opaque base** (`background-color: var(--cw-base); background-image: linear-gradient(var(--cw-surface), var(--cw-surface))`). Layering the colour instead of setting it means a skin that hands us a translucent surface still leaves the panel opaque — the panel is a floating card, and floating cards are not windows.
- `backdrop-filter` is gone. Blur only makes sense if you intend to see through.
- The stacking order still uses `--dsh-claude-layer-float`, which is the one thing that token is actually for.

The audit grew from 37 to 46 assertions so this cannot come back: the surface token must not be a `layer` token, both overlay states must paint a base colour *and* the gradient, no `backdrop-filter` anywhere, and the `z-index` must still clear the measured 10000 ceiling.

**Version reporting told a half-truth, so it was replaced by timestamps.** `loadedVersion` compared the manifest read at module load against the manifest on disk — which reads as "the module is stale" even when only `package.json` moved and the code is identical. `/state` now reports `version` (the manifest on disk), `loadedAt` (when this module generation was evaluated), `hostStamp` (`index.js`'s mtime) and `staleHost` (`hostStamp > loadedAt`). Same judgement the browser half already used for `clientStamp`, so both halves answer "am I running old code?" the same way.

## 0.3.1 — 2026-10-31

**The pill was sitting underneath other plugins' cards.**

Every registration in the host's overlay layer is a sibling, so they stack by `z-index` alone. Measured here, siblings go up to **10000** (`dsh-prompt`, `dshmarket`); this pill was at **42**, which is why it kept disappearing behind them. Both card and pill now sit at `100000`. That number is only relative to the overlay layer — the layer's own stacking context keeps the panel below the host's dialogs (which live at 1000–1100 in a different layer).

The style audit now asserts that *both* overlay states declare a `z-index` above that measured ceiling, so the value cannot regress quietly.

**Version reporting split in two.** `/state` used to report a version read once at module load, so after bumping the manifest the route still answered the old number while the disk already said otherwise — indistinguishable from "the reload failed". This first attempt (`loadedVersion`) was replaced in 0.3.2: two version numbers cannot express staleness, because a reload re-evaluates the same file and reports the same number.

## 0.3.0 — 2026-10-31

**The panel now reads the skin instead of carrying its own palette.**

- Every colour and duration comes from a host/skin token, each with a fallback, so the card follows `dsh-claude-style` (or any other skin, or none) instead of hard-coding a dark violet scheme that fought the terracotta accent.
- Motion added on the skin's own tokens: card entry on `ease-enter`, rows staggering in eight at a time, a breathing ring on the running dot. All of it respects `prefers-reduced-motion`.
- State is no longer colour-only: running is a filled dot, finished is flat grey, **stuck is a hollow ring** — terracotta and amber are indistinguishable at 6px.
- `thread_source` filters ("dispatch / review / subagent") got a right-sidebar tab with counts, so automated reviews can no longer crowd real dispatches off the visible rows.
- The "interface code changed" bar compares the page's load time against `client.js`'s mtime and offers a reload. It exists because a stale client bundle looks exactly like a plugin that silently failed.
- `/state` now reports the plugin `version` alongside `clientStamp`, so you can tell "the version didn't change" from "the old code is still running".
- Review and subagent rows no longer print two bare em dashes when there is no user message — a lone `—` reads as a rendering bug.

## 0.2.2 — 2026-10-31

**The right-sidebar tab stopped opening blank.**

A tab type registers in two stages: its body into `sidebar.right.pane.tab`, and its chip into `sidebar.right.pane.tab.title`, both keyed by the definition's id. Only the body was registered, so the tab had content but no way to be selected. Added the chip and the `TabChip` component.

The render test had been passing the whole time — its mock only allowed the seat names it already knew about, so the missing chip was never asserted. Mock allow-lists are now treated as a place where tests lie.

## 0.2.1 — 2026-10-31

**Fixed a time column that lied.**

Rows used the session's creation timestamp, so a thread resumed across several days read "running for 14246 minutes" while the actual turn took 72 seconds. Rows now carry `activeMs`: elapsed time for a running job, the last turn's `duration_ms` otherwise; finished rows show how long they have been idle.

## 0.2.0 — 2026-10-31

**Added the right-sidebar tab.**

The floating card only helps when you think to look at the corner. The tab is a full list with filters, in a place that is already open. It registers through `ctx.inject(['sidebarRightTabs'], …)` rather than the module-level `inject` array, so a host without that service loses one tab instead of deactivating the whole plugin.

## 0.1.0 — 2026-10-31

**First working version: read Codex rollouts, show them as a list.**

- Walks `~/.codex/sessions/<YYYY>/<MM>/<DD>/` by directory level instead of recursing, keeps a 3-day window.
- Reads the tail 512 KB of each rollout. The first line (`session_meta`) contains the entire base prompt, so the head read escalates 8 KB → 256 KB → 1 MB until a newline is found, then caches per path — a single 8 KB read silently fails `JSON.parse` and drops the session.
- Task text comes from `item_completed` / `UserMessage`; usage from `token_count.info.total_token_usage`; state from the presence of `task_started` without a matching `task_complete`, plus a 10-minute silence threshold for "stale".
- Incremental cache keyed by `size + mtime`, single-flight scans, and a read-only route allowed loopback only.
