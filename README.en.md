[简体中文](README.md) · **English**

# Codex workbench · dsh-codex-workbench

A "dispatch desk" for DeepSeek Harness (DSH): **one list of every job handed to Codex** — working directory, the task in your own words, how long it has been running, how many tokens it burned, what state it is in, and which files it produced.

It shows up twice: as a floating card in the bottom-right corner, and as a right-sidebar tab with the same name. Both read the same payload.

```
Dispatch desk                 232 rollouts scanned · +208     Collapse
┌──────────────────────────────────────────────────────────────┐
│ ● D:\Fun          dispatch                                2m │
│   Drop GIMP / Inkscape / Krita, move to the artcraft ones …  │
│   229.8M↓ 223.0Mc 690k↑  wait_agent  gpt-6.1-terra           │
│ ◉ D:\Fun          review                                 <1m │
│   The following is the Codex agent history added since …     │
│ ● D:\Fun          subagent                               <1m │
│   5.1M↓ 4.9Mc 16k↑  send_message                             │
│ ○ D:\Fun          dispatch                               3h ago │
│   Look at my recent work and actually analyse it             │
│   356k↓ 320kc 2k↑  wait_agent  gpt-6.1-sol                   │
└──────────────────────────────────────────────────────────────┘
```

## Why it exists

Handing work to Codex is an asynchronous delivery: the command returns, the job keeps running, and the UI has no session for it — only another process. So "where is it now?" gets answered by re-reading file timestamps under `~/.codex/sessions`, or by a human relaying three-state updates by hand.

This plugin turns that record into a table: which dispatch, in which directory, running for how long, costing how much, producing what. The bar is simple — **you should be able to tell "still working / stuck / finished" at a glance**, and then manual polling stops existing.

## Two entry points

| Entry | Seat | Notes |
| --- | --- | --- |
| Floating card | `shell.overlay` | Collapsed it is a pill, "Dispatch desk · N running"; clicking expands the card. Auto-expands while something runs |
| Right sidebar tab | `sidebar.right.pane.tab` + `.title` | The full list (untruncated) plus four filter chips: All / Dispatch / Review / Subagent |

- Your choice is remembered: once collapsed by hand it stops opening itself (kept in `localStorage`).
- Expanding a row shows the task text, the working directory, the last reply, and the produced files (newest first).
- If the page's client bundle is older than the file on disk, a bar appears: "Interface code changed · reload". One click, no guessing whether the edit took.

## Where the data comes from

Everything comes from the rollout logs Codex writes itself. The plugin only reads.

| Fact | Detail |
| --- | --- |
| Location | `%USERPROFILE%\.codex\sessions\<YYYY>\<MM>\<DD>\rollout-*.jsonl` (honours `CODEX_HOME`) |
| Read strategy | Only the **last 512 KB** per file — a single dispatch can write tens of megabytes. The first line (`session_meta`) carries the whole base prompt, so the head read escalates 8 KB → 256 KB → 1 MB until a newline is found, then caches |
| Task text | The text of `item_completed` where `item.type === "UserMessage"` — the sentence you typed, not a system prompt |
| Usage | `token_count` events' `info.total_token_usage`: `input` / `cached` / `output` |
| Kinds | `session_meta.thread_source`: `user` / `guardian_review` / `subagent`, ranked in that order so automated reviews cannot push real dispatches off screen |
| States | `running` (events within the last 10 minutes, last turn unfinished) / `done` (last turn ended with `task_complete`) / `stale` (an unfinished turn silent for over 10 minutes — usually stuck or gone) |
| Time column | Running rows show **elapsed** time (`activeMs`); the rest show **idle** time (since the last event). Neither is the session file's creation time, so a thread resumed across days no longer reads "running for 14246 minutes" |
| Measured here | 232 rollout files, 24 rows inside the 3-day window; full scan ~1.4 s, warm cache ~0.2 s |

Incremental by `size + mtime`: unchanged files are never re-read. Scans are single-flight (never two at once) and the route returns the cache first, then refreshes in the background.

## Interaction

| Action | Result |
| --- | --- |
| Click the pill | Expand / collapse the card |
| Click a row | Expand / collapse that dispatch's detail |
| Filter chips | Filter by `thread_source`; counts in parentheses |
| "Collapse" in the header | Affects the floating card only, and the choice is remembered |
| "Interface code changed" bar | Reload the page to pick up a new client bundle |

## Routes

| Route | Method | Notes |
| --- | --- | --- |
| `/plugins/codex-workbench/state` | GET | Sessions + scan statistics + client stamp + plugin version |
| `/plugins/codex-workbench/files?id=<sessionId>` | GET | Files produced by one dispatch (BFS depth 3, skipping `node_modules` and friends) |

Both routes accept **loopback requests only**; anything but GET is 405. The plugin makes no outbound network requests, and `dependencies` / `devDependencies` / `peerDependencies` are all empty.

## Design language

Colours and motion follow the active skin (here `dsh-claude-style`) rather than shipping a palette:

- Colours come only from host/skin tokens (`--dsw-alias-*`, `--dsh-tone-*`, `--dsh-claude-*`), and **every token carries a fallback** — with the skin disabled the panel still reads.
- Hairlines are 0.5px, radii stay on the 4 / 6 / 8 / 12 / 16 / 999 ladder, and focus uses the host's `--dsw-focus-ring-color` rather than the accent.
- Motion uses the skin's duration and easing tokens only: the card enters on `ease-enter`, rows stagger in (groups of 8, `duration-instant / 8` apart), the running dot breathes on `duration-fade × 8`. `prefers-reduced-motion` turns it all off.
- **State is not colour-only**: running is a filled accent dot with a breathing ring, finished is a flat grey dot, stuck is a **hollow ring** — terracotta and amber are too close at 6px, so shape carries part of the meaning.

## Install

This is a DSH bundle (`dsh.bundle.patch` points at `cordis.patch.yml`):

```js
// ask the DSH agent to run this
plugin_manager({ action: 'install_bundle',
                 target: 'D:\\path\\to\\dsh-codex-workbench' })
```

- `application: "applied"` means it took; on `failed`, read `warnings`.
- **Reload the page** (Ctrl+R) afterwards — that is when the new client bundle mounts.
- Editing the plugin does not need a restart: `plugin_manager({ action:'set_plugin', target:'include:dsh-codex-workbench', enabled:false })` then `enabled:true` (the entry id is not the package name).
- Self-check: in `GET /plugins/codex-workbench/state`, `version` must be the version you just wrote and `clientStamp` must equal the mtime of `client.js`.

## Compatibility and limits

- Measured only on **Windows + the DSH desktop app** (Electron's Node 24).
- Only structured rollout events are parsed; files hidden inside `ops_bash` command strings are deliberately not guessed at.
- The window is the last 3 days and at most 24 rows. Older history is not read, because "what is running now" is the question this panel answers.
- State is inferred from silence, not probed per process: a job quiet for 9 minutes still reads `running`. That is the deliberate conservative choice — calling a live job dead is worse than leaving it a while longer.

## Development

No build step. `index.js` is the host half (scan rollouts, fold events, register routes); `client.js` is the browser half (floating card + sidebar tab).

```bash
node --check index.js && node --check client.js
```

When touching the UI: this plugin ships no palette of its own, it reads the skin's tokens. Raw time values are only allowed inside token fallbacks.

## License

MIT — see [LICENSE](LICENSE).
