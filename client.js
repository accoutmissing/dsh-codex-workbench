window.__ModuleLoader__.load({
  id: '@local/dsh-codex-workbench',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const STATE_ROUTE = '/plugins/codex-workbench/state'
    const FILES_ROUTE = '/plugins/codex-workbench/files'
    const NS = 'dsh-codex-workbench'
    /** Open: a dispatch can change state inside one turn. Closed: the pill is a heartbeat. */
    const POLL_OPEN_MS = 3000
    const POLL_CLOSED_MS = 12000
    const STORAGE_KEY = 'dsh-codex-workbench:open'
    const ROW_LIMIT = 12
    /** Right-sidebar tab kind. The same string is the type id and the body's slot key. */
    const TAB_KIND = 'codex-workbench'
    /** Filters over `threadSource`, in chip order. `all` first so it is the default. */
    const FILTERS = [
      { key: 'all', label: 'filterAll', match: () => true },
      { key: 'user', label: 'filterUser', match: (session) => session.threadSource === 'user' },
      { key: 'review', label: 'filterReview', match: (session) => session.threadSource === 'guardian_review' },
      { key: 'sub', label: 'filterSub', match: (session) => session.threadSource === 'subagent' }
    ]
    /** Module evaluation time: a bundle rebuilt after this page loaded is not running here. */
    const LOADED_AT = Date.now()
    const CLOCK_SLACK_MS = 1000

    const zh = {
      overlay: 'Codex 派活台',
      title: '派活台',
      collapse: '收起',
      expand: '展开',
      scanned: '已扫 {scanned} 个 rollout',
      empty: '还没有 Codex 派活记录',
      error: '连不上宿主：{error}',
      retry: '重试',
      noCwd: '（无目录）',
      running: '在跑',
      done: '已完成',
      stale: '无响应',
      badgeUser: '派活',
      badgeReview: '审查',
      badgeSub: '子代理',
      badgeOther: '其它',
      task: '任务',
      last: '最后一条回复',
      files: '本次产物',
      loading: '读取中…',
      noFiles: '这个目录里没有新文件',
      turn: '本轮耗时 {value}',
      ago: '{value}前',
      stalePage: '界面代码已更新 · 点此刷新',
      tabTitle: '派活台',
      tabCount: '{n} 条 · {running} 在跑',
      filterAll: '全部',
      filterUser: '派活',
      filterReview: '审查',
      filterSub: '子代理',
      guideTitle: 'Codex 派活台',
      guideDescription: '每次派给 Codex 的任务：目录、时长、token、状态与本次产物。'
    }

    const en = {
      overlay: 'Codex workbench',
      title: 'Dispatches',
      collapse: 'Collapse',
      expand: 'Expand',
      scanned: '{scanned} rollouts scanned',
      empty: 'No Codex dispatch yet',
      error: 'Host unreachable: {error}',
      retry: 'Retry',
      noCwd: '(no directory)',
      running: 'running',
      done: 'done',
      stale: 'silent',
      badgeUser: 'dispatch',
      badgeReview: 'review',
      badgeSub: 'subagent',
      badgeOther: 'other',
      task: 'Task',
      last: 'Last reply',
      files: 'Files touched',
      loading: 'Reading…',
      noFiles: 'No new file in that directory',
      turn: 'Last turn {value}',
      ago: '{value} ago',
      stalePage: 'Interface code changed · reload',
      tabTitle: 'Dispatches',
      tabCount: '{n} · {running} running',
      filterAll: 'All',
      filterUser: 'Dispatch',
      filterReview: 'Review',
      filterSub: 'Subagent',
      guideTitle: 'Codex workbench',
      guideDescription: 'Every dispatch to Codex: directory, duration, tokens, state and the files that came out of it.'
    }

    const CSS = `
.cw-pill,.cw-card,.cw-tab{
  /* --dsh-claude-layer-float is a Z-INDEX (99999), not a colour: using it as a background made the
     declaration invalid, so the panel had no background at all and read as transparent. The card
     surface token is --dsh-claude-card, and anything painted below still starts from an opaque base
     so a translucent skin cannot bring the transparency back. */
  --cw-layer:var(--dsh-claude-layer-float,99999);
  --cw-surface:var(--dsh-claude-card,var(--dsw-alias-bg-overlay,#232323));
  --cw-base:var(--dsw-alias-bg-base,var(--dsh-claude-canvas,#191919));
  --cw-fill:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.045));
  --cw-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  --cw-line:var(--dsh-tone-border-1,var(--dsw-alias-border-l1,rgba(255,255,255,.12)));
  --cw-sep:var(--dsh-claude-divider,var(--dsw-alias-separator-primary,rgba(255,255,255,.1)));
  --cw-accent:var(--dsw-alias-brand-primary,#d97757);
  --cw-tint:var(--dsh-tone-accent-tint,rgba(217,119,87,.14));
  --cw-t1:var(--dsw-alias-label-primary,#ececec);
  --cw-t2:var(--dsw-alias-label-secondary,#a8a8a8);
  --cw-t3:var(--dsw-alias-label-tertiary,#8a8a8a);
  --cw-warn:var(--dsw-alias-state-warn-label,#d9a441);
  --cw-warn-fill:var(--dsw-alias-state-warn-tertiary,rgba(217,164,65,.16));
  --cw-mono:var(--dsh-claude-font-code,ui-monospace,SFMono-Regular,Menlo,monospace);
  --cw-sans:var(--dsw-font-family,ui-sans-serif,system-ui,sans-serif);
  --cw-ring:var(--dsw-focus-ring-color,var(--cw-accent));
  --cw-feedback:var(--dsh-claude-timing-feedback,120ms ease);
  --cw-reveal:var(--dsh-claude-duration-reveal,120ms) var(--dsh-claude-ease-out,ease-out);
  --cw-surface-t:var(--dsh-claude-duration-surface,150ms) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1));
  --cw-move:var(--dsh-claude-duration-move,200ms) var(--dsh-claude-ease-glide,cubic-bezier(.22,.61,.36,1));
  --cw-enter:var(--dsh-claude-duration-enter,320ms) var(--dsh-claude-ease-enter,cubic-bezier(.34,1.3,.64,1));
  --cw-instant:var(--dsh-claude-duration-instant,80ms);
  --cw-breath:calc(var(--dsh-claude-duration-fade,300ms) * 8)
}
/* Every registration in this overlay layer is a sibling, so they stack by z-index alone: measured
   siblings here go up to 10000 (dsh-prompt, dshmarket), so the panel takes the skin's float layer
   token (99999). That only reorders us inside the host's own overlay layer — the layer's own
   stacking context keeps us below the host's dialogs (1000-1100, a different layer). */
.cw-pill{position:fixed;right:16px;bottom:16px;z-index:var(--cw-layer);display:flex;align-items:center;gap:7px;
  padding:6px 11px;border-radius:999px;border:1px solid var(--cw-line);
  background-color:var(--cw-base);background-image:linear-gradient(var(--cw-surface),var(--cw-surface));
  color:var(--cw-t2);font-family:var(--cw-sans);font-size:11.5px;line-height:1.4;cursor:pointer;
  box-shadow:var(--dsw-alias-shadow-lv2,0 8px 24px rgba(0,0,0,.26));
  transition:color var(--cw-feedback),border-color var(--cw-feedback),transform var(--cw-feedback)}
.cw-pill:hover{color:var(--cw-t1);border-color:var(--cw-accent);transform:translateY(-1px)}
.cw-pill:active{transform:translateY(0) scale(.98)}
.cw-dot{width:6px;height:6px;border-radius:999px;flex:none;background:var(--cw-t3);box-sizing:border-box;
  transition:background var(--cw-feedback),border-color var(--cw-feedback)}
.cw-dot[data-state="running"]{background:var(--cw-accent);
  animation:cw-breath var(--cw-breath) var(--dsh-claude-ease-in-out,ease-in-out) infinite}
.cw-dot[data-state="done"]{background:var(--cw-t3)}
/* Stale reads as a hollow ring: terracotta (running) and amber (stale) are too close in
   hue to tell apart at 6px, so the state is also encoded by fill rather than colour alone. */
.cw-dot[data-state="stale"]{background:transparent;border:1.5px solid var(--cw-warn)}
@keyframes cw-breath{from{box-shadow:0 0 0 0 var(--cw-tint)}to{box-shadow:0 0 0 4px transparent}}
.cw-card{position:fixed;right:16px;bottom:16px;z-index:var(--cw-layer);width:384px;max-height:min(62vh,540px);
  display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--cw-line);
  background-color:var(--cw-base);background-image:linear-gradient(var(--cw-surface),var(--cw-surface));
  color:var(--cw-t1);font-family:var(--cw-sans);font-size:12px;line-height:1.5;
  box-shadow:var(--dsw-alias-shadow-lv2,0 16px 44px rgba(0,0,0,.3));overflow:hidden;transform-origin:100% 100%;
  animation:cw-card-in var(--cw-enter) both}
@keyframes cw-card-in{from{opacity:0;transform:translateY(8px) scale(.985)}
  to{opacity:1;transform:translateY(0) scale(1)}}
.cw-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:0.5px solid var(--cw-sep)}
.cw-title{font-family:inherit;font-weight:600;font-size:13px;letter-spacing:.01em;color:var(--cw-t1)}
.cw-tablabel{display:inline-flex;align-items:center;gap:5px;font-family:var(--cw-sans);font-size:11.5px;line-height:1}
.cw-sub{color:var(--cw-t3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-btn{margin-left:auto;background:none;border:none;color:var(--cw-t3);cursor:pointer;font-family:inherit;
  font-size:11px;line-height:1;padding:4px 2px;transition:color var(--cw-feedback)}
.cw-btn:hover{color:var(--cw-t1)}
.cw-pill:focus-visible,.cw-card button:focus-visible,.cw-tab button:focus-visible{
  outline:2px solid var(--cw-ring);outline-offset:-2px}
.cw-body{overflow:auto;padding:4px 0;scrollbar-width:thin}
.cw-stale{display:block;width:100%;border:none;border-bottom:0.5px solid var(--cw-warn);
  background:var(--cw-warn-fill);color:var(--cw-warn);font-family:inherit;font-size:11px;line-height:1.4;
  padding:5px 12px;cursor:pointer;text-align:left;transition:background var(--cw-feedback)}
.cw-stale:hover{background:var(--dsw-alias-state-warn-secondary,var(--cw-warn-fill))}
.cw-row{padding:7px 12px;border-left:2px solid transparent;cursor:pointer;
  transition:background var(--cw-feedback),border-color var(--cw-feedback);
  animation:cw-row-in var(--cw-reveal) both;
  animation-delay:calc(var(--cw-i,0) * var(--cw-instant) / 8)}
@keyframes cw-row-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
.cw-row:hover{background:var(--cw-hover)}
.cw-row[data-selected="1"]{background:var(--cw-tint);border-left-color:var(--cw-accent)}
.cw-line{display:flex;align-items:center;gap:6px;min-width:0}
.cw-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.cw-badge{flex:none;font-size:10px;line-height:1.5;padding:0 5px;border-radius:999px;
  color:var(--cw-t3);border:1px solid var(--cw-line)}
.cw-badge[data-kind="user"]{color:var(--cw-t1);border-color:var(--cw-t2)}
.cw-time{margin-left:auto;flex:none;color:var(--cw-t3);font-variant-numeric:tabular-nums}
.cw-task{color:var(--cw-t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.cw-meta{color:var(--cw-t3);font-size:11px;display:flex;gap:8px;white-space:nowrap;overflow:hidden;
  font-variant-numeric:tabular-nums}
.cw-detail{padding:8px 12px;border-top:0.5px solid var(--cw-sep);background:var(--cw-fill);
  animation:cw-detail-in var(--cw-reveal) both}
@keyframes cw-detail-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}
.cw-label{color:var(--cw-t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;margin-top:6px}
.cw-value{color:var(--cw-t2);word-break:break-all}
.cw-pre{max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--cw-t2);
  background:var(--cw-fill);border-radius:6px;padding:6px;margin-top:2px;font-family:var(--cw-mono);font-size:11px}
.cw-file{display:flex;gap:6px;color:var(--cw-t2);padding:2px 0;font-family:var(--cw-mono);font-size:11px;
  border-top:0.5px solid var(--cw-sep);transition:color var(--cw-feedback)}
.cw-file:first-of-type{border-top:none}
.cw-file:hover{color:var(--cw-t1)}
.cw-file span:last-child{margin-left:auto;color:var(--cw-t3);font-variant-numeric:tabular-nums}
.cw-empty{padding:20px 12px;text-align:center;color:var(--cw-t3)}
.cw-tab{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--cw-t1);
  font-family:var(--cw-sans);font-size:12px;line-height:1.5}
.cw-tabHead{display:flex;align-items:baseline;gap:8px;padding:10px 12px 6px}
.cw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}
.cw-chip{display:inline-flex;align-items:center;gap:5px;background:none;cursor:pointer;
  border:1px solid var(--cw-line);color:var(--cw-t3);border-radius:999px;padding:2px 9px;
  font-family:inherit;font-size:11px;line-height:1.6;
  transition:color var(--cw-feedback),border-color var(--cw-feedback),background var(--cw-feedback)}
.cw-chip:hover{color:var(--cw-t1);border-color:var(--cw-t2)}
.cw-chip[data-on="1"]{color:var(--cw-accent);border-color:var(--cw-tint);background:var(--cw-tint)}
.cw-chip b{font-weight:500;font-variant-numeric:tabular-nums;opacity:.7}
.cw-tabList{flex:1;min-height:0;overflow:auto;padding-bottom:8px;scrollbar-width:thin}
.cw-tab .cw-name{max-width:38ch}
.cw-tab .cw-task{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cw-tab .cw-detail{margin:2px 12px 6px;border:1px solid var(--cw-line);border-radius:8px}
.cw-body::-webkit-scrollbar,.cw-tabList::-webkit-scrollbar,.cw-pre::-webkit-scrollbar{width:8px;height:8px}
.cw-body::-webkit-scrollbar-thumb,.cw-tabList::-webkit-scrollbar-thumb,.cw-pre::-webkit-scrollbar-thumb{
  background:var(--dsh-claude-scrollbar,var(--dsh-scrollbar-thumb,rgba(255,255,255,.18)));border-radius:999px}
.cw-body::-webkit-scrollbar-thumb:hover,.cw-tabList::-webkit-scrollbar-thumb:hover,
.cw-pre::-webkit-scrollbar-thumb:hover{
  background:var(--dsh-claude-scrollbar-hover,var(--dsh-scrollbar-thumb-hover,rgba(255,255,255,.32)))}
.cw-body::-webkit-scrollbar-track,.cw-tabList::-webkit-scrollbar-track,
.cw-pre::-webkit-scrollbar-track{background:transparent}
@media (prefers-reduced-motion:reduce){
  .cw-card,.cw-row,.cw-detail,.cw-dot,.cw-stale{animation:none!important}
  .cw-pill,.cw-chip,.cw-row,.cw-btn,.cw-stale,.cw-file,.cw-dot{transition:none!important}
  .cw-pill:hover{transform:none}
}
`

    function readOpen() {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === '1'
      } catch {
        return false
      }
    }

    function writeOpen(open) {
      try {
        window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
      } catch {
        /* a private window still works, it just forgets */
      }
    }

    /** One store per page load, so a re-mounted slot keeps its answer and its open state. */
    const store = {
      snap: { data: null, error: null, open: readOpen(), manual: false },
      listeners: new Set(),
      busy: false,
      get() {
        return store.snap
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      patch(next) {
        store.snap = Object.assign({}, store.snap, next)
        for (const listener of store.listeners) listener(store.snap)
      },
      async refresh() {
        if (store.busy) return
        store.busy = true
        try {
          const response = await fetch(STATE_ROUTE, { cache: 'no-store' })
          const body = await response.json()
          if (body === null || typeof body !== 'object' || body.ok !== true) {
            throw new Error(body && body.error ? String(body.error) : 'bad answer')
          }
          store.patch({ data: body, error: null })
        } catch (error) {
          store.patch({ error: error instanceof Error ? error.message : String(error) })
        } finally {
          store.busy = false
        }
      }
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
      const minutes = Math.floor(ms / 60000)
      if (minutes < 1) return '<1m'
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      const restMinutes = minutes % 60
      if (hours < 24) return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`
      const days = Math.floor(hours / 24)
      return `${days}d${hours % 24}h`
    }

    function formatTokens(tokens) {
      if (tokens === null || typeof tokens !== 'object') return '—'
      const short = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
        if (value >= 1000) return `${Math.round(value / 1000)}k`
        return String(value)
      }
      return `${short(tokens.input)}↓ ${short(tokens.cached)}c ${short(tokens.output)}↑`
    }

    /** A finished run is best described by when it went quiet, not by total lifetime. */
    function formatAgo(at, t) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '—'
      const minutes = Math.floor((Date.now() - at) / 60000)
      const value =
        minutes < 1 ? '<1m' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
      return t('ago').replace('{value}', value)
    }

    /** Last two segments: `工作\1_适枫` says more than `1_适枫` alone. */    function shortPath(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]/u).filter((part) => part !== '')
      return parts.slice(-2).join('\\')
    }

    function badgeKey(source) {
      if (source === 'user') return 'badgeUser'
      if (source === 'guardian_review') return 'badgeReview'
      if (source === 'subagent') return 'badgeSub'
      return 'badgeOther'
    }

    function formatBytes(size) {
      if (typeof size !== 'number' || !Number.isFinite(size)) return ''
      if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}M`
      if (size >= 1024) return `${Math.round(size / 1024)}k`
      return `${size}B`
    }

    function Row({ session, selected, onSelect, t, index = 0 }) {
      const stateKey = session.state === 'running' ? 'running' : session.state === 'done' ? 'done' : 'stale'
      return h(
        'div',
        {
          className: 'cw-row',
          'data-selected': selected ? '1' : '0',
          style: { '--cw-i': String(index) },
          onClick: onSelect,
          title: `${session.cwd || t('noCwd')}\n${session.task || ''}`.trim()
        },
        h(
          'div',
          { className: 'cw-line' },
          h('span', { className: 'cw-dot', 'data-state': stateKey }),
          h('span', { className: 'cw-name' }, shortPath(session.cwd) || t('noCwd')),
          h('span', { className: 'cw-badge', 'data-kind': String(session.threadSource ?? '') },
            t(badgeKey(session.threadSource))),
          h('span', { className: 'cw-time' },
            session.state === 'running'
              ? formatDuration(session.activeMs ?? session.elapsedMs)
              : formatAgo(session.lastEventAt, t))
        ),
        // Review and subagent runs carry no user message and sometimes no counter at all;
        // an em dash on its own line reads as a rendering bug, so both lines are optional.
        session.task ? h('div', { className: 'cw-task' }, session.task) : null,
        (session.tokens || session.lastTool || session.model)
          ? h(
              'div',
              { className: 'cw-meta' },
              session.tokens ? h('span', null, formatTokens(session.tokens)) : null,
              session.lastTool ? h('span', null, session.lastTool) : null,
              session.model ? h('span', null, session.model) : null
            )
          : null
      )
    }

    function Detail({ session, t }) {
      const [files, setFiles] = useState({ loading: true })

      useEffect(() => {
        let cancelled = false
        setFiles({ loading: true })
        fetch(`${FILES_ROUTE}?id=${encodeURIComponent(session.id)}`, { cache: 'no-store' })
          .then((response) => response.json())
          .then((body) => {
            if (!cancelled) setFiles(Object.assign({ loading: false }, body))
          })
          .catch((error) => {
            if (!cancelled) {
              setFiles({ loading: false, error: error instanceof Error ? error.message : String(error) })
            }
          })
        return () => {
          cancelled = true
        }
      }, [session.id])

      const listed = Array.isArray(files.files) ? files.files : []

      return h(
        'div',
        { className: 'cw-detail' },
        h('div', { className: 'cw-label' }, t('task')),
        h('div', { className: 'cw-value' }, session.task || '—'),
        h('div', { className: 'cw-label' }, 'cwd'),
        h('div', { className: 'cw-value' }, session.cwd || t('noCwd')),
        session.lastMessage
          ? h(
              React.Fragment,
              null,
              h('div', { className: 'cw-label' }, t('last')),
              h('div', { className: 'cw-pre' }, session.lastMessage)
            )
          : null,
        h('div', { className: 'cw-label' }, t('files')),
        files.loading === true
          ? h('div', { className: 'cw-sub' }, t('loading'))
          : files.error
            ? h('div', { className: 'cw-sub' }, String(files.error))
            : listed.length === 0
              ? h('div', { className: 'cw-sub' }, t('noFiles'))
              : h(
                  'div',
                  null,
                  listed.slice(0, 8).map((file) =>
                    h(
                      'div',
                      { className: 'cw-file', key: file.path, title: file.path },
                      h('span', null, file.name),
                      h('span', null, formatBytes(file.size))
                    )
                  ),
                  files.truncated ? h('div', { className: 'cw-sub' }, '…') : null
                )
      )
    }

    function Panel({ t }) {
      const [snap, setSnap] = useState(store.get())
      const [selected, setSelected] = useState(null)

      useEffect(() => {
        setSnap(store.get())
        return store.subscribe(setSnap)
      }, [])

      const data = snap.data
      const sessions = data !== null && Array.isArray(data.sessions) ? data.sessions : []
      const running = sessions.filter((session) => session.state === 'running').length

      // Auto behaviour only until the human decides: a manual toggle wins for good.
      useEffect(() => {
        if (snap.manual) return
        const wantOpen = running > 0
        if (wantOpen !== snap.open) {
          store.patch({ open: wantOpen })
          writeOpen(wantOpen)
        }
      }, [running, snap.manual, snap.open])

      const toggle = useCallback(() => {
        const next = !store.get().open
        store.patch({ open: next, manual: true })
        writeOpen(next)
        if (next) void store.refresh()
      }, [])

      const retry = useCallback(() => {
        void store.refresh()
      }, [])

      if (!snap.open) {
        return h(
          'button',
          { type: 'button', className: 'cw-pill', onClick: toggle, title: t('overlay') },
          h('span', { className: 'cw-dot', 'data-state': running > 0 ? 'running' : 'done' }),
          h('span', null, running > 0 ? `${t('title')} · ${running} ${t('running')}` : t('title')),
          h('span', null, sessions.length > 0 ? String(sessions.length) : '')
        )
      }

      const shown = sessions.slice(0, ROW_LIMIT)

      return h(
        'div',
        { className: 'cw-card' },
        h(
          'div',
          { className: 'cw-head' },
          h('span', { className: 'cw-title' }, t('title')),
          h('span', { className: 'cw-sub' },
            data === null
              ? t('loading')
              : t('scanned').replace('{scanned}', String(data.scanned ?? 0)) +
                (data.skipped > 0 ? ` · +${data.skipped}` : '')),
          h('button', { type: 'button', className: 'cw-btn', onClick: toggle }, t('collapse'))
        ),
        data !== null && typeof data.clientStamp === 'number' && data.clientStamp > LOADED_AT + CLOCK_SLACK_MS
          ? h(
              'button',
              { type: 'button', className: 'cw-stale', onClick: () => window.location.reload() },
              t('stalePage')
            )
          : null,
        h(
          'div',
          { className: 'cw-body' },
          snap.error !== null && data === null
            ? h(
                'div',
                { className: 'cw-empty' },
                h('div', null, t('error').replace('{error}', String(snap.error))),
                h('button', { type: 'button', className: 'cw-btn', onClick: retry }, t('retry'))
              )
            : shown.length === 0
              ? h('div', { className: 'cw-empty' }, t('empty'))
              : shown.map((session, index) =>
                  h(
                    React.Fragment,
                    { key: session.id },
                    h(Row, {
                      session,
                      index,
                      selected: session.id === selected,
                      t,
                      onSelect: () => setSelected(selected === session.id ? null : session.id)
                    }),
                    session.id === selected ? h(Detail, { session, t }) : null
                  )
                )
        )
      )
    }

    /** Three dispatch rows: the package icon's shape, drawn inline so no icon package is needed. */
    function DispatchGlyph({ size = 16, className }) {
      const row = (y, opacity) => [
        h('circle', { key: `d${y}`, cx: 3, cy: y + 0.8, r: 1.4, fill: 'currentColor', opacity }),
        h('rect', { key: `b${y}`, x: 6, y, width: 8, height: 1.6, rx: 0.8, fill: 'currentColor', opacity })
      ]
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', className, 'aria-hidden': 'true' },
        row(3.2, 1),
        row(7.2, 0.75),
        row(11.2, 0.5)
      )
    }

    /** The chip beside the tab body: a tab registered without one opens blank. */
    function TabChip({ t }) {
      return h(
        'span',
        { className: 'cw-tablabel' },
        h(DispatchGlyph, { size: 13 }),
        h('span', null, t('tabTitle'))
      )
    }

    /** Right sidebar tab: every dispatch, filterable, no row cap. */
    function TabBody({ t }) {
      const [snap, setSnap] = useState(store.get())
      const [selected, setSelected] = useState(null)
      const [filter, setFilter] = useState('all')

      useEffect(() => {
        setSnap(store.get())
        return store.subscribe(setSnap)
      }, [])

      const data = snap.data
      const sessions = data !== null && Array.isArray(data.sessions) ? data.sessions : []
      const running = sessions.filter((session) => session.state === 'running').length
      const current = FILTERS.find((entry) => entry.key === filter) || FILTERS[0]
      const shown = sessions.filter(current.match)
      const stale =
        data !== null && typeof data.clientStamp === 'number' && data.clientStamp > LOADED_AT + CLOCK_SLACK_MS

      return h(
        'div',
        { className: 'cw-tab' },
        h(
          'div',
          { className: 'cw-tabHead' },
          h('span', { className: 'cw-title' }, t('tabTitle')),
          h(
            'span',
            { className: 'cw-sub' },
            data === null
              ? t('loading')
              : t('tabCount').replace('{n}', String(shown.length)).replace('{running}', String(running))
          )
        ),
        stale
          ? h(
              'button',
              { type: 'button', className: 'cw-stale', onClick: () => window.location.reload() },
              t('stalePage')
            )
          : null,
        h(
          'div',
          { className: 'cw-chips' },
          FILTERS.map((entry) => {
            const count = entry.key === 'all' ? sessions.length : sessions.filter(entry.match).length
            return h(
              'button',
              {
                key: entry.key,
                type: 'button',
                className: 'cw-chip',
                'data-on': filter === entry.key ? '1' : '0',
                onClick: () => setFilter(entry.key)
              },
              t(entry.label),
              h('b', null, String(count))
            )
          })
        ),
        h(
          'div',
          { className: 'cw-tabList' },
          snap.error !== null && data === null
            ? h(
                'div',
                { className: 'cw-empty' },
                h('div', null, t('error').replace('{error}', String(snap.error))),
                h('button', { type: 'button', className: 'cw-btn', onClick: () => void store.refresh() }, t('retry'))
              )
            : shown.length === 0
              ? h('div', { className: 'cw-empty' }, t('empty'))
              : shown.map((session, index) =>
                  h(
                    React.Fragment,
                    { key: session.id },
                    h(Row, {
                      session,
                      index,
                      t,
                      selected: session.id === selected,
                      onSelect: () => setSelected(selected === session.id ? null : session.id)
                    }),
                    session.id === selected ? h(Detail, { session, t }) : null
                  )
                )
        )
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const offZh = ctx.locale.register(NS, 'zh', zh)
          const offEn = ctx.locale.register(NS, 'en', en)
          return () => {
            offZh()
            offEn()
          }
        }, 'codex-workbench: dictionaries')

        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'codex-workbench: styles')

        ctx.effect(() => {
          let timer
          const tick = () => {
            if (document.hidden !== true) void store.refresh()
            timer = window.setTimeout(tick, store.get().open ? POLL_OPEN_MS : POLL_CLOSED_MS)
          }
          void store.refresh()
          timer = window.setTimeout(tick, POLL_OPEN_MS)
          return () => window.clearTimeout(timer)
        }, 'codex-workbench: polling')

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-codex-workbench',
              order: 60,
              label: () => t('overlay')
            },
            (props) => h(Panel, Object.assign({}, props, { t }))
          )
        )

        // The tab is optional on purpose: declared through ctx.inject, a host without the
        // right-sidebar registry still gets the floating card instead of losing both.
        ctx.inject(['sidebarRightTabs'], (withTabs) => {
          // Type first, body second: the pane renders a tab only when its kind is known.
          withTabs.effect(
            () =>
              withTabs.sidebarRightTabs.register({
                id: TAB_KIND,
                kind: TAB_KIND,
                title: () => t('tabTitle'),
                guide: [
                  {
                    order: 60,
                    title: () => t('guideTitle'),
                    description: () => t('guideDescription'),
                    icon: DispatchGlyph
                  }
                ]
              }),
            'codex-workbench: tab type'
          )

          withTabs.effect(
            () =>
              withTabs.slots.inject('sidebar.right.pane.tab', () =>
                withTabs.slots.register(
                  { name: 'sidebar.right.pane.tab', key: TAB_KIND, locale: NS },
                  (props) => h(TabBody, Object.assign({}, props, { t }))
                )
              ),
            'codex-workbench: tab body'
          )

          withTabs.effect(
            () =>
              withTabs.slots.inject('sidebar.right.pane.tab.title', () =>
                withTabs.slots.register(
                  { name: 'sidebar.right.pane.tab.title', key: TAB_KIND, locale: NS },
                  () => h(TabChip, { t })
                )
              ),
            'codex-workbench: tab chip'
          )
        })
      }
    }
  }
})
