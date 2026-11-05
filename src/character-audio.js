/** Fixed absolute seats, never viewer-relative: all clients hear the same character. */
export const CHARACTERS = Object.freeze([
  { id: 'sweet', name: '小桃', style: '萝莉音', portrait: '/characters/sweet.png' },
  { id: 'elegant', name: '清岚', style: '御姐音', portrait: '/characters/elegant.png' },
  { id: 'sunny', name: '晴禾', style: '阳光少女音', portrait: '/characters/sunny.png' },
])
export function characterForSeat(seat) { return CHARACTERS[seat] || CHARACTERS[0] }
export function clipForEvent(event, characters) {
  if (!Number.isInteger(event?.seat) || event.seat < 0 || event.seat > 2) return null
  let clip
  if (event.type === 'discard' && Number.isInteger(event.tile) && event.tile >= 0 && event.tile < 18) clip = `${event.tile < 9 ? 'tiao' : 'tong'}-${event.tile % 9 + 1}`
  else if (event.type === 'peng') clip = 'peng'
  else if (event.type === 'hu') clip = event.source === 'selfDraw' ? 'zimo' : ['discard', 'kongDiscard'].includes(event.source) ? 'fangpao' : event.source === 'robKong' ? 'qianggang' : null
  else if (['mingGang', 'anGang', 'buGang', 'addGang'].includes(event.type)) clip = 'gang'
  return clip ? `/voices/${(CHARACTERS.find(character => character.id === characters?.[event.seat]) || characterForSeat(event.seat)).id}/${clip}.mp3` : null
}

/** Only classify a win from the committed source, using the winner's character. */
export function clipsForEvent(event, characters) {
  const clip = clipForEvent(event, characters)
  if (!clip) return []
  return [clip]
}

/** Observe committed server history, not speculative button clicks or pending claims. */
export class ActionVoiceCursor {
  reset() { this.gameKey = null; this.count = 0; this.revision = -1 }
  constructor() { this.reset() }
  consumeEvents(state, { silent = false } = {}) {
    const history = state?.game?.history || []
    const key = state?.game ? `${state.id}:${state.game.id || 'legacy'}` : null
    if (!key) { this.reset(); return [] }
    if (this.gameKey === key && state.revision < this.revision) return []
    const baseline = key !== this.gameKey || history.length < this.count
    const events = baseline || silent ? [] : history.slice(this.count)
    this.gameKey = key; this.count = history.length; this.revision = state.revision
    return events.map((event, index) => ({ ...event, eventKey: `${key}:${this.count - events.length + index}`, urls: clipsForEvent(event, state.game.characters) }))
  }
  consume(state, options) { return this.consumeEvents(state, options).flatMap(event => event.urls) }
}

/** A single serial WebAudio queue. Unlock must run directly in a user gesture. */
export class CharacterAudio {
  constructor({ createContext = () => new (window.AudioContext || window.webkitAudioContext)(), fetchAudio = (url, options) => fetch(url, options), now = () => Date.now(), onStatus = () => {} } = {}) {
    this.createContext = createContext; this.fetchAudio = fetchAudio; this.now = now; this.onStatus = onStatus
    this.queue = []; this.buffers = new Map(); this.loads = new Set(); this.muted = false; this.unlocked = false; this.generation = 0; this.running = false
  }
  async unlock() {
    try {
      this.context ||= this.createContext()
      this.context.onstatechange = () => {
        if (!this.disposed && this.context.state !== 'running') {
          this.unlocked = false; this.clear(); this.onStatus('locked')
        }
      }
      await this.context.resume()
      if (this.context.state !== 'running') throw new Error('Audio locked')
      const source = this.context.createBufferSource()
      source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate)
      source.connect(this.context.destination); source.start()
      this.unlocked = true; this.onStatus('ready')
      return true
    } catch { this.unlocked = false; this.onStatus('locked'); return false }
  }
  setMuted(value) { this.muted = value; if (value) this.clear() }
  clear() {
    this.generation++; this.queue = []
    for (const controller of this.loads) { this.buffers.delete(controller.url); controller.abort() }
    this.activeItem = null
    try { this.source?.stop() } catch { /* already stopped */ }
    this.source = null
  }
  enqueue(urls) {
    if (this.context && this.context.state !== 'running') { this.unlocked = false; this.onStatus('locked') }
    if (this.muted || !this.unlocked || this.context?.state !== 'running') return
    const at = this.now()
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index], group = [url]
      this.queue.push({ urls: group, at })
    }
    let queuedClips = this.queue.reduce((count, item) => count + item.urls.length, 0)
    while (queuedClips > 12) queuedClips -= this.queue.shift().urls.length
    this.drain()
  }
  /** Live snapshots already include automatic turns. Never narrate that backlog. */
  enqueueLive(events) {
    if (this.muted || !this.unlocked || this.context?.state !== 'running') return
    const voiced = events.filter(event => event.urls?.length)
    if (!voiced.length) return
    const wins = voiced.filter(event => event.type === 'hu')
    // A win takes precedence over all ordinary calls in its atomic server update.
    // Without a win, only the latest committed public action is still current.
    const latest = wins.length ? wins.slice(-2) : voiced.slice(-1)
    if (this.activeItem?.live && this.activeItem.kind === 'hu' && !wins.length) return
    this.clear()
    const at = this.now()
    this.queue.push({ urls: latest.flatMap(event => event.urls), at, live: true,
      kind: wins.length ? 'hu' : latest[0].type, maxAge: wins.length ? 650 : 550 })
    this.drain()
  }
  /** Warm only short public win calls, in three bounded background requests. */
  async warmWins(characters) {
    if (this.muted || !this.unlocked || this.context?.state !== 'running') return
    const generation = this.generation
    const urls = [...new Set([0, 1, 2].flatMap(seat => ['selfDraw', 'discard', 'robKong']
      .flatMap(source => clipsForEvent({ type: 'hu', seat, source }, characters))))]
    let next = 0
    await Promise.all([0, 1, 2].map(async () => {
      while (next < urls.length && generation === this.generation && !this.muted && this.unlocked) {
        try { await this.buffer(urls[next++]) } catch { /* Optional warming must never block play. */ }
      }
    }))
  }
  async buffer(url) {
    if (!this.buffers.has(url)) {
      const controller = new AbortController(); controller.url = url; this.loads.add(controller)
      let timer
      const cancelled = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Voice load cancelled')), { once: true })
        timer = setTimeout(() => controller.abort(), 4000)
      })
      const download = this.fetchAudio(url, { signal: controller.signal }).then(response => {
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Voice unavailable')
        return response.arrayBuffer()
      }).then(bytes => this.context.decodeAudioData(bytes))
      const promise = Promise.race([download, cancelled]).finally(() => {
        clearTimeout(timer); this.loads.delete(controller)
      })
      this.buffers.set(url, promise)
      promise.catch(() => { if (this.buffers.get(url) === promise) this.buffers.delete(url) })
    }
    return this.buffers.get(url)
  }
  async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && !this.muted && this.unlocked) {
        const item = this.queue.shift(), generation = this.generation
        this.activeItem = item
        const maxAge = item.maxAge ?? 6000
        if (this.now() - item.at > maxAge) continue
        try {
          // Load the whole event before speaking. Once started, its remaining clips
          // cannot expire or be evicted by newer events; explicit clearing can stop it.
          const buffers = await Promise.all(item.urls.map(url => this.buffer(url)))
          if (generation !== this.generation || this.muted || this.now() - item.at > maxAge || this.context.state !== 'running') continue
          for (const buffer of buffers) {
            if (generation !== this.generation || this.muted || !this.unlocked || this.context.state !== 'running') break
            await new Promise(resolve => {
              const source = this.context.createBufferSource(); this.source = source
              source.buffer = buffer; source.connect(this.context.destination)
              source.onended = resolve; source.start(); this.onStatus('ready')
            })
          }
        } catch { if (generation === this.generation) this.onStatus('unavailable') }
      }
    } finally { this.source = null; this.activeItem = null; this.running = false }
  }
  dispose() { this.disposed = true; this.clear(); this.context?.close(); this.unlocked = false }
}
