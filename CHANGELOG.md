# Changelog

Why each version exists, not just what changed.

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
