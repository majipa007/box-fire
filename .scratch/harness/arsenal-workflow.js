export const meta = {
  name: 'boxfire-arsenal-resume',
  description: 'Resume the arsenal from saved work, four parallel tracks: core (bots, docs, review), models, sound and effects, HUD and loadout; each critiqued and fixed',
  phases: [
    { title: 'Build', detail: 'four tracks at once, each in its own worktree' },
    { title: 'Review', detail: 'adversarial critic and fix per track' },
  ],
}
const REPO = '/home/sukuna/personal_projects/game'
const W = '/home/sukuna/personal_projects/boxfire-work'
const H = `${REPO}/.scratch/harness`
const BASE = '5ada528' // ar/core: registry, 10 gun files, mechanics, loadout, balance (hashes were rewritten 16/10)

const ROSTER = `THE ROSTER is already in shared/guns/ (read index.js and each file):
- sidearms: pistol, handcannon ("Sledge"), machinepistol;
- primaries: rifle, shotgun, smg, burst, lmg, marksman, sniper.
Each gun file exports one object with stats, a class and a slot, plus three presentation fields on their own lines: look, sound and icon, currently null. Until a gun has its own presentation, the client falls back to the nearest launch gun (baseGun in shared/guns/index.js).`

const RULES = (wt, branch, port, own) => `Boxfire is a browser LAN FPS: a three.js r186 client, a Node ws server (60 Hz, server-authoritative, prediction and rewind hit registration), and shared deterministic simulation in shared/. The plan is "${REPO}/LAN Box Shooter — Design & Build Plan.md"; the art and feel spec is ${REPO}/docs/bible.md.
${ROSTER}
Ground rules:
- Work ONLY in the git worktree ${wt} (branch ${branch}). Never touch ${REPO} or another worktree.
- Files you own: ${own}. Three other tracks run in parallel on the same base, so touch nothing else. In a gun file, edit ONLY your own field's line or block, in place.
- TEST-DRIVEN, following the mattpocock tdd skill: vertical slices, a failing test at a public seam seen FAILING first, then the minimal code; behaviour, not internals; no tautologies. Visual and audio work is verified by screenshots and renders.
- Every check must pass before each commit: REPO=${wt} PORT=${port} ${H}/all.sh && git commit ... Commit messages must NOT contain any Co-Authored-By line (user rule); the author identity comes from git config (majipa007).5 <noreply@anthropic.com>. Never push. Commit early and often.
- Scratch files go only under ${W}/tmp/ar/.
- Headless browser checks:
  - Command: REPO=${wt} PORT=${port} BOTS=n OUT=${W}/shots/ar VIEW=960x540 ${H}/serve.sh ${H}/pw/<script>. Use main's pw scripts.
  - Bots are passive by default; set BOTARGS="--skill normal" for fights.
  - SwiftShader fps means nothing. Browsers queue two at a time.
  - Track pids, never use pkill -f with a pattern, and NEVER use port 3100 (the user plays there).
- No per-frame allocations in hot paths, and no external requests. The game must always start, join, play and shoot.
- The user is impatient and wants it COMPLETE and high quality ("BROOO COMPLETE IT"): finish all 10 guns in your scope. Don't leave stubs.`

const SUMMARY = { type: 'object', properties: {
  branch: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } },
  tests_added: { type: 'array', items: { type: 'string' } }, measurements: { type: 'string' }, screenshots: { type: 'array', items: { type: 'string' } },
  integration_notes: { type: 'string' }, open_issues: { type: 'array', items: { type: 'string' } } },
  required: ['branch', 'commits', 'files', 'tests_added', 'measurements', 'screenshots', 'integration_notes', 'open_issues'] }
const CRIT = { type: 'object', properties: {
  must_fix: { type: 'array', items: { type: 'object', properties: { issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['issue', 'evidence', 'fix'] } },
  nice_to_have: { type: 'array', items: { type: 'string' } }, verdict: { type: 'string' } }, required: ['must_fix', 'nice_to_have', 'verdict'] }

const TRACKS = [
  { name: 'core', port: 3161, setup: `RESUME: a previous core builder was cut off when the session restarted. Your worktree ${W}/arsenal/core (branch ar/core) ALREADY EXISTS with its committed work (git log ${BASE}..HEAD) and uncommitted work in progress (git status, git diff). Do NOT recreate it. Review what is there, finish or fix the uncommitted work, commit it with the checks passing, then complete the rest of the brief.`,
    own: 'tools/bot.js, tools/bot/*, docs/guns.md (new), .scratch/harness/ (a committed copy of the balance Monte Carlo), the plan doc\'s weapon and loadout sections, and shared/ (but NOT the look, sound or icon fields of gun files)',
    ask: `You are the CORE finisher. The registry, mechanics (burst, scope with KEY.AIM, per-gun speed), loadout {primary, secondary} and balance are committed on ar/core (git log main..HEAD). Finish:
1. BOTS: a random primary and sidearm per life from the registry. Roles come from gun numbers: burst fires like duty bursts with the burst delay; a scoped gun scopes before firing, stops to shoot, and keeps a long ideal range. Do a live check where bots carry every gun (force each in turn, or log the gun mix), with no errors and real kills with each.
2. docs/guns.md:
   - every field of a gun file, including the presentation fields' schemas, written loosely enough for the other tracks: look is a box model; sound is a synthesis recipe; icon is an SVG path in a 24x24 viewBox;
   - "How to add a gun": copy a file, edit it, add the id to the end of index.js, run the validation test and the balance script;
   - the final kill tables per gun.
3. Commit the balance Monte Carlo under .scratch/harness/ so anyone can rerun it.
4. A live smoke: pick each sidearm and each primary through the loadout message, spawn, fire, and check the server accepts it and the client predicts it (no corrections piling up).`,
    crit: 'Check the bots with every gun live, docs/guns.md completeness (someone can add a gun from it alone), loadout validation, determinism, balance (re-run the Monte Carlo), and that the game plays.' },
  { name: 'models', port: 3162, setup: `RESUME: a previous models builder was cut off when the session restarted. Your worktree ${W}/arsenal/models (branch ar/models) ALREADY EXISTS with its committed work (git log ${BASE}..HEAD) and uncommitted work in progress (git status, git diff). Do NOT recreate it. Review what is there, finish or fix the uncommitted work, commit it with the checks passing, then complete the rest of the brief.`,
    own: 'the look field of every shared/guns/*.js file, client/viewmodel.js, client/characters.js and their tests',
    ask: `Give all 10 guns their models, defined ONCE in each gun file's look field (box parts with colour keys, plus bone tags for magazine, slide and bolt). Move today's rifle, pistol and shotgun models into their files' look, so every gun works the same way.
- client/viewmodel.js builds the first-person gun from look, with reload animations by class: a magazine (pistol, hand cannon as a revolver cylinder or speedloader, machine pistol, rifle, SMG, burst, LMG with a box or belt, marksman), shells (shotgun), and a bolt plus magazine (sniper). A scoped sniper hides the gun (the HUD draws the scope).
- client/characters.js builds the third-person gun from the same look, dropping small parts. Stay inside the bible's draw-call and triangle budgets.
- Every gun must be recognisable in silhouette, in the bible's palette, at today's rifle quality or better.
- Screenshots: every gun in first person (?debug has viewmodel views; read viewmodel.js) and a third-person lineup. View each critically.
- The fallback via baseGun must disappear for guns that now have a look.`,
    crit: 'Check all 10 guns in first and third person (screenshots), silhouettes, quality against the bible and today\'s rifle, reload animations per class, budgets, and that one look definition drives both views.' },
  { name: 'soundfx', port: 3163, setup: `RESUME: a previous soundfx builder was cut off when the session restarted. Your worktree ${W}/arsenal/soundfx (branch ar/soundfx) ALREADY EXISTS with its committed work (git log ${BASE}..HEAD) and uncommitted work in progress (git status, git diff). Do NOT recreate it. Review what is there, finish or fix the uncommitted work, commit it with the checks passing, then complete the rest of the brief.`,
    own: 'the sound field of every shared/guns/*.js file, client/audio.js, client/effects.js and their tests',
    ask: `Give all 10 guns their own sound via each gun file's sound field: a recipe on audio.js's synthesis (layers, pitch, body, tail). For example: the hand cannon a deep boom, the machine pistol a light rattle, the LMG heavy and steady, the sniper a sharp crack with a long tail, the burst rifle three crisp shots. Move the launch guns' recipes into their files too. Distance, pan and reverb keep working.
In client/effects.js, give each gun its tracer and muzzle look by class: a thick bright sniper tracer, faint SMG tracers, a big hand-cannon flash, and so on.
Verify with the audio soundboard and OfflineAudioContext renders (see audio.js and its tests), plus effect stills.`,
    crit: 'Check that every gun has a distinct, good sound (render and compare), that mix levels sit inside the bible\'s mix table, that tracer and muzzle looks differ per class, and perf.' },
  { name: 'hud', port: 3164, setup: `RESUME: a previous hud builder was cut off when the session restarted. Your worktree ${W}/arsenal/hud (branch ar/hud) ALREADY EXISTS with its committed work (git log ${BASE}..HEAD) and uncommitted work in progress (git status, git diff). Do NOT recreate it. Review what is there, finish or fix the uncommitted work, commit it with the checks passing, then complete the rest of the brief.`,
    own: 'the icon field of every shared/guns/*.js file, client/ui.js, client/index.html, client/input.js (only the scope key binding, if missing) and their tests',
    ask: `Build the arsenal's HUD:
1. The B loadout panel, also on the respawn screen: two rows, sidearm and primary. Each gun gets a card with its icon, name, class and stat bars (damage, fire rate, range, mobility, derived from its stats), and the selected cards are highlighted. Choices send {primary, secondary} and apply at the next spawn. Keyboard and mouse both work. It must fit at 960x540.
2. Kill-feed and HUD weapon icons from each gun file's icon field (SVG paths in the HUD's style) for all 10 guns, including the launch three.
3. The ammo display shows the fire mode for burst, and handles the LMG's big magazine.
4. The sniper scope overlay when scoped: a scope ring, a crosshair and darkened edges in the HUD's style, with the normal crosshair hidden.
5. The scope key is in the rebinding list.
Screenshots: the panel at 1280x720 and 960x540, the kill feed with several guns, and the scope overlay. View them critically.`,
    crit: 'Check the panel (both resolutions, keyboard and mouse, {primary, secondary} sent, applied on spawn), all 10 icons, the scope overlay, burst and ammo display, and rebinding.' },
]

const out = await pipeline(TRACKS,
  (t) => {
    const wt = `${W}/arsenal/${t.name}`
    return agent(`${RULES(wt, `ar/${t.name}`, t.port, t.own)}\n\n${t.setup}\n\n${t.ask}\n\nFinish everything in scope, commit, and return the structured summary.`, { label: `build:${t.name}`, phase: 'Build', schema: SUMMARY })
  },
  (summary, t) => {
    const wt = `${W}/arsenal/${t.name}`
    return agent(`You are the adversarial critic for the "${t.name}" track of Boxfire's new 10-gun arsenal. Default to finding problems.\n${ROSTER}\nThe work is on branch ar/${t.name} in ${wt} (git -C ${wt} diff ${BASE}...HEAD). Its brief:\n${t.ask}\n${t.crit}\nThe builder's summary:\n${JSON.stringify(summary, null, 1)}\nRun REPO=${wt} PORT=${t.port + 10} ${H}/all.sh; any failure is a must_fix. Play it with short headless runs, and view screenshots with Read. Never use port 3100. Do NOT edit files under ${W}/arsenal or ${REPO}; scratch goes in ${W}/tmp/ar/. Return only real, evidenced findings.`, { label: `critique:${t.name}`, phase: 'Review', schema: CRIT })
      .then((critique) => ({ summary, critique }))
  },
  ({ summary, critique }, t) => {
    if (!critique || !critique.must_fix.length) return { name: t.name, summary, must_fix: 0 }
    const wt = `${W}/arsenal/${t.name}`
    return agent(`${RULES(wt, `ar/${t.name}`, t.port, t.own)}\n\nYou built the "${t.name}" track; your worktree already exists. Fix every must_fix test-first; if one is wrong, explain why with evidence. Take the cheap, clearly worthwhile nice_to_have items. Re-verify, commit, and return the updated summary.\nBrief:\n${t.ask}\nYour summary:\n${JSON.stringify(summary, null, 1)}\nCritique:\n${JSON.stringify(critique, null, 1)}`, { label: `fix:${t.name}`, phase: 'Review', schema: SUMMARY })
      .then((fixed) => ({ name: t.name, summary: fixed ?? summary, must_fix: critique.must_fix.length }))
  },
)
return out.filter(Boolean)
