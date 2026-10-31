import { appendFileSync, readFileSync, renameSync, statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Codex workbench — the Host half.
 *
 * Codex writes one JSONL rollout per dispatch under `~/.codex/sessions`; this
 * half folds their tails into one row per dispatch and serves the result to the
 * browser half. It is deliberately read-only: nothing here starts, stops, or
 * writes a Codex session, so a bug can waste work but cannot destroy it.
 */

const STATE_ROUTE = '/plugins/codex-workbench/state'
const FILES_ROUTE = '/plugins/codex-workbench/files'
/** Our own browser bundle: its mtime tells an already-open page that code moved. */
const PACKAGE_FILE = fileURLToPath(new URL('./package.json', import.meta.url))
const CLIENT_FILE = fileURLToPath(new URL('./client.js', import.meta.url))

/** How far back a rollout still counts as "one of today's dispatches". */
const LOOKBACK_DAYS = 3
/** Rows beyond this are noise; the newest ones are the ones being watched. */
const MAX_SESSIONS = 24
/** A 35 MB rollout must never be read whole: the tail carries the current state. */
const TAIL_BYTES = 512 * 1024
/** `session_meta` is the first line only; a small head read is enough for it. */
const HEAD_BYTES = 8 * 1024
/** No append for this long means the run is over, whatever the last event says. */
const STALE_MS = 10 * 60 * 1000
/** A fresh dispatch may be younger than the first event we can see. */
const YOUNG_MS = 3 * 60 * 1000

/** Directories that never contain a dispatch's own output. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.gradle',
  'vendor'
])

const ARTIFACT_DEPTH = 3
const ARTIFACT_DIRS = 400
const ARTIFACT_ENTRIES = 20_000
const ARTIFACT_LIMIT = 60

const LOG_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'codex-workbench.log')
const LOG_MAX_BYTES = 1_000_000

const ROLLOUT_RE = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/

/** `~/.codex/sessions`, honouring CODEX_HOME the way the CLI does. */
function sessionsRoot() {
  const home = process.env.CODEX_HOME
  return home !== undefined && home !== '' ? join(home, 'sessions') : join(homedir(), '.codex', 'sessions')
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Keep one log line one log line: control bytes would let a value forge its own entry. */
function oneLine(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 2000)
}

function log(text) {
  try {
    try {
      if (statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`)
    } catch {
      /* the rotation probe is the only reader; a missing file is the normal case */
    }
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${oneLine(text)}\n`, 'utf8')
  } catch {
    /* the answer to the caller is what matters */
  }
}

function json(res, status, body) {
  // An answer that already went out cannot be replaced; end it cleanly instead
  // of throwing a headers-already-sent error out of the route.
  if (res.headersSent === true) {
    if (res.writableEnded !== true && res.destroyed !== true) res.end()
    return
  }
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** The floor under every route body. */
function guard(path, handler) {
  return (req, res) => {
    const fail = (error) => {
      log(`cannot answer ${path}: ${messageOf(error)}`)
      try {
        json(res, 503, { ok: false, error: 'internal error' })
      } catch {
        /* the response is already gone; the log line is what is left to say */
      }
    }
    try {
      const answer = handler(req, res)
      if (answer !== null && typeof answer === 'object' && typeof answer.then === 'function') {
        answer.then(undefined, fail)
      }
    } catch (error) {
      fail(error)
    }
  }
}

function fromLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Local wall-clock stamp in a rollout file name: `rollout-2026-10-31T10-03-24-<uuid>`. */
function startFromName(name) {
  const match = ROLLOUT_RE.exec(name)
  if (match === null) return null
  const [, year, month, day, hour, minute, second, id] = match
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime()
  return { id, at: Number.isFinite(at) ? at : 0 }
}

/** Flatten a content array into one line of text, or ''. */
function textOf(content) {
  if (typeof content === 'string') return content.replace(/\s+/gu, ' ').trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (typeof part === 'string') parts.push(part)
    else if (part !== null && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

function clip(value, limit) {
  const text = String(value ?? '').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Two versions, on purpose.
 *
 * `LOADED_VERSION` is what this host module generation started with: it never
 * changes, so a stale generation keeps answering with its own number and you can
 * see that the reload did not happen.
 *
 * `manifestVersion()` reads the manifest on disk, re-reading only when its mtime
 * moves. Reporting that as `version` keeps the answer honest about the artifact
 * itself; comparing the two tells "the file on disk is old" (equal) from "the
 * module is old" (different).
 */
const LOADED_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')).version ?? null
  } catch {
    return null
  }
})()

let manifestCache = { mtimeMs: -1, version: LOADED_VERSION }

function manifestVersion() {
  try {
    const { mtimeMs } = statSync(PACKAGE_FILE)
    if (mtimeMs === manifestCache.mtimeMs) return manifestCache.version
    const version = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')).version ?? null
    manifestCache = { mtimeMs, version }
    return version
  } catch {
    return manifestCache.version
  }
}

/**
 * A page that loaded before this plugin's bundle was rebuilt keeps running the
 * old code. Comparing against the file's mtime is the only honest test: the boot
 * graph revision only moves when something tells the module server to rebuild.
 */
function clientStamp() {
  try {
    return statSync(CLIENT_FILE).mtimeMs
  } catch {
    return null
  }
}

/**
 * What the module server currently says about our browser half. An empty list
 * means the half never reached the boot graph, which is worth knowing before
 * blaming the panel for not appearing.
 */
function describeClient(ctx) {
  const modules = ctx.get('clientModules')
  if (modules === undefined || modules === null) return null
  let graph
  try {
    graph = modules.graph()
  } catch {
    return null
  }
  const entries = Array.isArray(graph?.entries) ? graph.entries : []
  const mine = entries.filter((entry) => String(entry?.id ?? '').includes('codex-workbench'))
  return {
    graphRev: graph?.rev ?? null,
    total: entries.length,
    entries: mine.map((entry) => ({ id: entry.id, rev: entry.rev, immediately: entry.immediately === true }))
  }
}

async function readRange(path, start, length) {
  const handle = await open(path, 'r')
  try {
    if (length <= 0) return ''
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * The first line of a rollout is `session_meta`, and it carries the whole base
 * system prompt — often far beyond one small read. Widen only until the line
 * ends, then keep the answer for the life of the process: it never changes.
 */
const metaCache = new Map()

async function readMeta(path) {
  if (metaCache.has(path)) return metaCache.get(path)
  let meta = null
  for (const limit of [HEAD_BYTES, 256 * 1024, 1024 * 1024]) {
    try {
      const head = await readRange(path, 0, limit)
      if (limit < 1024 * 1024 && head.indexOf('\n') === -1) continue
      const first = head.split('\n', 1)[0]
      if (first.trim().length === 0) continue
      const raw = JSON.parse(first)
      if (raw !== null && typeof raw === 'object') {
        meta = raw.type === 'session_meta' ? raw.payload : raw.payload ?? null
      }
      break
    } catch {
      /* a malformed first line is not fatal: the tail still describes the run */
    }
  }
  metaCache.set(path, meta)
  return meta
}

async function readTail(path, size) {
  const length = Math.min(size, TAIL_BYTES)
  const start = Math.max(0, size - length)
  return { text: await readRange(path, start, length), truncated: start > 0 }
}

/**
 * Fold the tail of one rollout into the row the panel shows.
 *
 * Tolerant on purpose: a half-flushed last line, a banner, or an event type from
 * a future Codex version must never break the fold — the row degrades instead.
 */
function foldTail(meta, tail, truncated, fileMtimeMs) {
  const lines = tail.split('\n')
  // The first line of a tail window is almost always cut in half.
  if (truncated && lines.length > 0) lines.shift()

  let cwd = typeof meta?.cwd === 'string' ? meta.cwd : ''
  let model = ''
  let task = ''
  let lastMessage = ''
  let lastTool = ''
  let tokens = null
  let lastStartedAt = 0
  let lastCompleteAt = 0
  let durationMs = 0
  let lastEventAt = 0

  for (const line of lines) {
    const text = line.trim()
    // Cheap reject before JSON.parse on a 500 KB window.
    if (text.length === 0 || text.charCodeAt(0) !== 123) continue
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      continue
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const at = Date.parse(raw.timestamp)
    if (Number.isFinite(at) && at > lastEventAt) lastEventAt = at
    const payload = raw.payload
    if (payload === null || typeof payload !== 'object') continue
    const kind = String(payload.type ?? '')

    if (raw.type === 'turn_context') {
      if (typeof payload.cwd === 'string' && payload.cwd !== '') cwd = payload.cwd
      if (typeof payload.model === 'string') model = payload.model
      continue
    }
    if (raw.type === 'session_meta') {
      if (cwd === '' && typeof payload.cwd === 'string') cwd = payload.cwd
      continue
    }
    if (raw.type === 'response_item' && kind === 'function_call') {
      if (typeof payload.name === 'string') lastTool = payload.name
      continue
    }
    if (raw.type !== 'event_msg') continue

    if (kind === 'task_started') {
      if (Number.isFinite(at)) lastStartedAt = Math.max(lastStartedAt, at)
    } else if (kind === 'task_complete') {
      if (Number.isFinite(at)) lastCompleteAt = Math.max(lastCompleteAt, at)
      if (typeof payload.last_agent_message === 'string') lastMessage = payload.last_agent_message
      if (finite(payload.duration_ms) !== null) durationMs = payload.duration_ms
    } else if (kind === 'token_count') {
      const total = payload.info?.total_token_usage
      if (total !== null && typeof total === 'object' && finite(total.input_tokens) !== null) {
        tokens = {
          input: finite(total.input_tokens) ?? 0,
          cached: finite(total.cached_input_tokens) ?? 0,
          output: finite(total.output_tokens) ?? 0,
          reasoning: finite(total.reasoning_output_tokens) ?? 0,
          total: finite(total.total_tokens) ?? 0
        }
      }
    } else if (kind === 'item_completed') {
      const item = payload.item
      if (item !== null && typeof item === 'object' && String(item.type ?? '') === 'UserMessage') {
        const asked = textOf(item.content)
        if (asked !== '') task = asked
      }
    }
  }

  const now = Date.now()
  const quietMs = Math.max(0, now - fileMtimeMs)
  // Newer event wins; when neither is in the window, the file's silence decides.
  const running =
    lastStartedAt > lastCompleteAt ? quietMs < STALE_MS : lastStartedAt > 0 ? false : quietMs < YOUNG_MS

  return {
    cwd,
    model,
    task: clip(task, 400),
    lastMessage: clip(lastMessage, 4000),
    lastTool,
    tokens,
    startedAt: lastStartedAt > 0 ? lastStartedAt : null,
    completedAt: lastCompleteAt > 0 ? lastCompleteAt : null,
    durationMs,
    lastEventAt: lastEventAt > 0 ? lastEventAt : fileMtimeMs,
    running
  }
}

/** Walk `YYYY/MM/DD` one level at a time: a recursive readdir over 225 files is not free. */
async function collectRollouts(root) {
  const found = []
  const years = await readdirSafe(root)
  for (const year of years) {
    if (!/^\d{4}$/u.test(year.name)) continue
    for (const month of await readdirSafe(join(root, year.name))) {
      if (!/^\d{2}$/u.test(month.name)) continue
      for (const day of await readdirSafe(join(root, year.name, month.name))) {
        if (!/^\d{2}$/u.test(day.name)) continue
        const dir = join(root, year.name, month.name, day.name)
        for (const file of await readdirSafe(dir)) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
          const name = startFromName(file.name)
          if (name === null) continue
          const full = join(dir, file.name)
          let info
          try {
            info = await stat(full)
          } catch {
            continue
          }
          found.push({ path: full, size: info.size, mtimeMs: info.mtimeMs, id: name.id, nameStart: name.at })
        }
      }
    }
  }
  return found
}

async function readdirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Cache: a rollout is re-read only when its size or mtime moved. */
const cache = new Map()
let scanPromise = null
let lastScanAt = 0
let lastScan = { sessions: [], files: 0, skipped: 0 }

async function describe(file) {
  const known = cache.get(file.path)
  if (known !== undefined && known.size === file.size && known.mtimeMs === file.mtimeMs) return known.row

  const meta = await readMeta(file.path)

  let tail = { text: '', truncated: false }
  try {
    tail = await readTail(file.path, file.size)
  } catch {
    /* unreadable right now (locked by Codex); the row keeps its previous values next scan */
  }

  const folded = foldTail(meta, tail.text, tail.truncated, file.mtimeMs)
  const startedAt = meta !== null && typeof meta.timestamp === 'string' ? Date.parse(meta.timestamp) : NaN
  const start = Number.isFinite(startedAt) ? startedAt : file.nameStart
  const end = Math.max(file.mtimeMs, folded.lastEventAt)
  // Three states worth telling apart: still appending, finished a turn, or
  // went quiet without finishing one (killed, or the window closed).
  const state = folded.running
    ? 'running'
    : folded.completedAt !== null && folded.completedAt >= folded.startedAt
      ? 'done'
      : Date.now() - file.mtimeMs < STALE_MS
        ? 'running'
        : 'stale'
  const row = {
    id: file.id,
    path: file.path,
    name: basename(file.path),
    // `user` is a real dispatch; `guardian_review` and `subagent` are Codex's own
    // runs and would otherwise drown the list in work nobody asked for.
    threadSource: typeof meta?.thread_source === 'string' ? meta.thread_source : '',
    cwd: folded.cwd,
    model: folded.model,
    task: folded.task,
    lastMessage: folded.lastMessage,
    lastTool: folded.lastTool,
    tokens: folded.tokens,
    state,
    startedAt: start,
    lastEventAt: end,
    // How long the current turn has been working. `start` is when the session was
    // created, which for a thread resumed across days says nothing useful.
    activeMs: folded.running
      ? Math.max(0, Date.now() - (folded.startedAt ?? end))
      : folded.durationMs,
    elapsedMs: Math.max(0, (folded.running ? Date.now() : end) - start),
    turnMs: folded.durationMs
  }
  cache.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, row })
  return row
}

async function scan() {
  const root = sessionsRoot()
  const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const all = await collectRollouts(root)
  const recent = all
    .filter((file) => file.mtimeMs >= since)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SESSIONS)

  const rows = []
  for (const file of recent) {
    try {
      rows.push(await describe(file))
    } catch (error) {
      log(`cannot read ${file.path}: ${messageOf(error)}`)
    }
  }

  // Drop cache entries that fell out of the window so a long session does not grow it.
  const keep = new Set(recent.map((file) => file.path))
  for (const path of [...cache.keys()]) if (!keep.has(path)) cache.delete(path)

  const rank = (row) => (row.threadSource === 'user' ? 0 : row.threadSource === 'subagent' ? 2 : 1)
  rows.sort((left, right) => {
    if (left.state === 'running' && right.state !== 'running') return -1
    if (right.state === 'running' && left.state !== 'running') return 1
    // A real dispatch outranks Codex's own review runs; recency decides the rest.
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return right.lastEventAt - left.lastEventAt
  })

  lastScan = { sessions: rows, files: all.length, skipped: all.length - recent.length }
  lastScanAt = Date.now()
  return lastScan
}

/** One scan at a time; concurrent requests wait for the one in flight. */
function fresh() {
  if (scanPromise !== null) return scanPromise
  scanPromise = scan()
    .catch((error) => {
      log(`scan failed: ${messageOf(error)}`)
      return lastScan
    })
    .finally(() => {
      scanPromise = null
    })
  return scanPromise
}

async function ensureScanned() {
  if (lastScanAt === 0) return fresh()
  // Serve the cache immediately and refresh behind the answer.
  void fresh()
  return lastScan
}

/** Files under a dispatch's working directory touched since it started. */
async function listArtifacts(cwd, since) {
  if (typeof cwd !== 'string' || cwd === '') return { files: [], truncated: false }
  const out = []
  let dirs = 0
  let visited = 0
  let truncated = false

  const queue = [{ dir: cwd, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()
    if (dirs >= ARTIFACT_DIRS || visited >= ARTIFACT_ENTRIES) {
      truncated = true
      break
    }
    dirs += 1
    const entries = await readdirSafe(dir)
    for (const entry of entries) {
      visited += 1
      if (visited >= ARTIFACT_ENTRIES) {
        truncated = true
        break
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth + 1 <= ARTIFACT_DEPTH && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ dir: full, depth: depth + 1 })
        }
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (info.mtimeMs < since) continue
      out.push({ path: full, name: entry.name, size: info.size, mtimeMs: info.mtimeMs })
    }
  }

  out.sort((left, right) => right.mtimeMs - left.mtimeMs)
  if (out.length > ARTIFACT_LIMIT) truncated = true
  return { files: out.slice(0, ARTIFACT_LIMIT), truncated }
}

/** The routes are the only thing this plugin asks the host for. */
export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: STATE_ROUTE,
        handler: guard(STATE_ROUTE, async (req, res) => {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          if (!fromLoopback(req)) {
            json(res, 403, { ok: false, error: 'only available from this machine' })
            return
          }
          const scanResult = await ensureScanned()
          json(res, 200, {
            ok: true,
            now: Date.now(),
            root: sessionsRoot(),
            lookbackDays: LOOKBACK_DAYS,
            scanned: scanResult.files,
            skipped: scanResult.skipped,
            version: manifestVersion(),
            loadedVersion: LOADED_VERSION,
            scannedAt: lastScanAt,
            clientStamp: clientStamp(),
            client: describeClient(ctx),
            sessions: scanResult.sessions
          })
        })
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: FILES_ROUTE,
        handler: guard(FILES_ROUTE, async (req, res) => {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          if (!fromLoopback(req)) {
            json(res, 403, { ok: false, error: 'only available from this machine' })
            return
          }
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const id = url.searchParams.get('id') ?? ''
          if (lastScanAt === 0) await fresh()
          const row = lastScan.sessions.find((session) => session.id === id)
          if (row === undefined) {
            json(res, 404, { ok: false, error: 'unknown session' })
            return
          }
          if (row.cwd === '') {
            json(res, 200, { ok: true, cwd: '', files: [], truncated: false, reason: 'no working directory recorded' })
            return
          }
          const listed = await listArtifacts(row.cwd, row.startedAt - 1000)
          json(res, 200, { ok: true, cwd: row.cwd, ...listed })
        })
      })
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  void fresh()
}

/** Exposed for the self-test: the fold is the part worth pinning down. */
export const internals = { foldTail, startFromName, listArtifacts, sessionsRoot, scan }
