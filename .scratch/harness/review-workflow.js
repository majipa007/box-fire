export const meta = {
  name: 'boxfire-review',
  description: 'Multi-lens review of the integrated Boxfire overhaul: find, adversarially verify, then fix by file owner in worktrees',
  phases: [
    { title: 'Review', detail: 'one reviewer per lens over the integrated build' },
    { title: 'Verify', detail: 'skeptics try to refute each finding' },
    { title: 'Fix', detail: 'one fixer per file owner, in its own worktree' },
  ],
}

const H = args.harness // check and screenshot tools (committed in the repo)
const W = args.work // worktrees, screenshots and scratch files, outside the repo
const REPO = args.repo
const BIBLE = `${REPO}/docs/bible.md`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths, the main one first' },
          evidence: { type: 'string', description: 'file:line, screenshot path or command output' },
          fix: { type: 'string', description: 'the concrete change' },
        },
        required: ['title', 'severity', 'files', 'evidence', 'fix'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: { type: 'string' }, description: 'titles of the findings fixed' },
    rejected: { type: 'array', items: { type: 'string' }, description: 'title: why it was not fixed, with evidence' },
    checks: { type: 'string', description: 'all.sh result' },
  },
  required: ['commits', 'fixed', 'rejected', 'checks'],
}

const COMMON = `Boxfire is a browser LAN FPS: three.js r186 client, Node.js server, shared deterministic simulation, 60 Hz server-authoritative netcode with prediction, reconciliation and rewind. The integrated build is at ${REPO} (branch main). The spec for the look, feel and power-ups is ${BIBLE}; the netcode and gameplay spec is "${REPO}/LAN Box Shooter — Design & Build Plan.md". The target is a steady 60 fps at 1080p on an Intel Iris Xe iGPU, with no CDN or internet at runtime.
Tools:
- every check: REPO=${REPO} PORT=<your port> ${H}/all.sh
- screenshots: REPO=${REPO} PORT=<your port> BOTS=4 OUT=${W}/shots/review-<your lens or label> VIEW=960x540 ${H}/serve.sh ${H}/pw/shots.mjs <prefix>, then view them with Read
- interactions: ${H}/pw/smoke.mjs with a steps file (see ${H}/pw/README.md and ${H}/pw/steps*.mjs), VIEW=640x360
- current screenshots of the integrated build: ${args.shots.join(', ')}
Headless Chromium renders on SwiftShader (CPU), so its fps means nothing; judge cost by draw calls and triangles (?debug stats line) and per-frame work.
Scratch files go under ${W}/tmp/ only. Do NOT edit files in the repo. Report only real problems with evidence; a finding you cannot evidence is not a finding.`

const LENSES = [
  { key: 'art', port: 3121, prompt: 'Lens: art director. View every screenshot and take more angles if you need them. Judge against the bible and the reference games (Krunker, Voxiom, Valorant, Teardown, Minecraft with shaders, Blur): is it genuinely stunning and cohesive, with soul, or still bland? Check palette, light, sky, landscape, materials, characters, viewmodel, impacts, power-up identity, and the HUD. Each finding names the exact module and constant or code to change.' },
  { key: 'perf', port: 3122, prompt: 'Lens: iGPU performance engineer. Count draw calls and triangles by category, shader cost (fragment work per pixel, overdraw from transparent effects and fullscreen passes), texture memory, per-frame allocations and GC pressure in hot paths (frame loop, effects, characters, audio), timers, and the low preset and dynamic resolution. Estimate ms per frame on an Iris Xe at 1080p and flag anything that threatens 60 fps.' },
  { key: 'gameplay', port: 3123, prompt: 'Lens: game designer. Check gunplay and power-up balance against the bible: time to kill, power-up numbers, pad placement and respawn timers, spawn safety, counterplay, and Blur flair (trails, telegraphs, satisfying hits). Run bots and read the server log. Flag anything unfair, dominant, unreadable or unfun.' },
  { key: 'netcode', port: 3124, prompt: 'Lens: netcode engineer. Check that prediction stays exact with every power-up (boost, knockback, mines, shields), that reconcile replays them, that rewind hit registration still holds, that snapshot and event sizes stay small, and that every new client message is validated at the trust boundary (bad, oversized or out-of-range input must not crash or cheat the server). Run the live checks.' },
  { key: 'correctness', port: 3125, prompt: 'Lens: correctness. Hunt bugs and edge cases across the diff since 14c0ff5 (git -C ' + REPO + ' diff 14c0ff5..HEAD): lifecycle (join, leave, rejoin, respawn, match end, empty reset), resource disposal and leaks, listener and timer cleanup, NaN and divide-by-zero paths, pooled-object reuse, and error handling.' },
  { key: 'feel', port: 3126, prompt: 'Lens: game feel. Judge recoil and its recovery, camera bob, landing dip, roll, the dynamic crosshair, hit and kill feedback, viewmodel motion, and the audio mix and timing against the bible. Use steps runs to fire, move, jump and use power-ups. Flag anything that feels off, mushy, noisy or late, with the constant to change.' },
  { key: 'hud', port: 3127, prompt: 'Lens: HUD and UI. Check readability at 1080p and 1366x768, the vendored font loads with no network, health, ammo, power-up slots, kill feed, scoreboard, lobby, settings and key rebinding (every action, including use and cycle power-up), and basic accessibility (contrast, focus, nothing colour-only). PDPA: player names must never be logged or stored.' },
]

const OWNERS = args.owners
const ownerOf = (file) => Object.keys(OWNERS).find((o) => OWNERS[o].some((p) => file === p || file.startsWith(p))) || 'core'

const reviewed = await pipeline(
  LENSES,
  (l) => agent(`${COMMON}\n\n${l.prompt}\nUse port ${l.port} for any server you start.`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (r, l, li) => parallel((r?.findings || []).map((f, j) => () => {
    const votes = f.severity === 'critical' ? 3 : 1
    return parallel(Array.from({ length: votes }, (_, i) => () => agent(`${COMMON}\n\nA reviewer (${l.key} lens) claims this problem. Try to refute it: read the code, run what you need (port ${3200 + li * 100 + j * 3 + i}), and decide whether it is real, reproducible and worth fixing as stated. Default to refuted=true if you cannot confirm it.\n${JSON.stringify(f, null, 1)}`, { label: `verify:${l.key}:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })))
      .then((vs) => {
        const ok = vs.filter(Boolean)
        const upheld = ok.filter((v) => !v.refuted).length
        return { ...f, lens: l.key, upheld: upheld * 2 > ok.length, reasons: ok.map((v) => v.reason) }
      })
  })),
)

const all = reviewed.filter(Boolean).flat().filter(Boolean)
const confirmed = all.filter((f) => f.upheld)
log(`${all.length} findings, ${confirmed.length} upheld, ${all.length - confirmed.length} refuted`)

const groups = {}
for (const f of confirmed) (groups[ownerOf(f.files[0] || '')] ??= []).push(f)

const fixed = await parallel(Object.entries(groups).map(([owner, fs]) => () => agent(`${COMMON.replace('Do NOT edit files in the repo. ', '')}

You are the fixer for the "${owner}" files (${(OWNERS[owner] || ['client/main.js', 'client/render.js', 'client/net.js', 'server/index.js']).join(', ')}). Work ONLY in the git worktree ${W}/ws/${owner} (branch ws/${owner}, already reset to the integrated main); never touch ${REPO} or another worktree. You may make small edits outside your files when a fix needs them; mark each with a "// review:" comment.
Fix every upheld finding below. If one turns out wrong, say why with evidence instead. Every check must pass before each commit: REPO=${W}/ws/${owner} PORT=${args.ports[owner]} ${H}/all.sh. Verify visual fixes with screenshots viewed with Read. Commit with clear messages ending with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>. Never push.

${JSON.stringify(fs, null, 1)}`, { label: `fix:${owner}`, phase: 'Fix', schema: FIX_SCHEMA }).then((r) => ({ owner, findings: fs.length, ...r }))))

return { refuted: all.filter((f) => !f.upheld).map((f) => `${f.lens}: ${f.title} — ${f.reasons.join(' / ')}`), fixed: fixed.filter(Boolean) }
