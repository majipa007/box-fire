export const meta = {
  name: 'boxfire-build',
  description: 'Build the Boxfire art, feel and power-up overhaul: parallel workstreams in their own worktrees, each critiqued adversarially and fixed',
  phases: [
    { title: 'Build', detail: 'one builder per workstream, in its own git worktree and port' },
    { title: 'Critique', detail: 'adversarial critic per workstream: spec, quality bar, performance, bugs' },
    { title: 'Fix', detail: 'the must-fix findings addressed and re-verified' },
  ],
}

const H = args.harness // check and screenshot tools (committed in the repo)
const W = args.work // worktrees, screenshots and scratch files, outside the repo
const REPO = args.repo
const BIBLE = `${REPO}/docs/bible.md`

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'commit subjects on the branch' },
    files: { type: 'array', items: { type: 'string' } },
    api: { type: 'string', description: 'the exported API the integrator must wire, with signatures and where to call it from' },
    integration_edits: { type: 'string', description: 'edits made to main.js, render.js or net.js, if any, and why' },
    screenshots: { type: 'array', items: { type: 'string' }, description: 'absolute paths of the final screenshots' },
    perf: { type: 'string', description: 'draw calls, triangles and fps measured, plus how' },
    tests: { type: 'string', description: 'npm test result and any new tests' },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commits', 'files', 'api', 'integration_edits', 'screenshots', 'perf', 'tests', 'open_issues'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    must_fix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          evidence: { type: 'string', description: 'file:line, screenshot path or command output' },
          fix: { type: 'string' },
        },
        required: ['issue', 'evidence', 'fix'],
      },
    },
    nice_to_have: { type: 'array', items: { type: 'string' } },
    quality: { type: 'number', description: '0-10: how close to stunning and soulful against the reference games' },
    verdict: { type: 'string' },
  },
  required: ['must_fix', 'nice_to_have', 'quality', 'verdict'],
}

const rules = (w) => `Ground rules:
- Work ONLY in your git worktree: ${W}/ws/${w.name} (branch ws/${w.name}). It holds a full copy of the repo, with node_modules symlinked. Never touch the main repo at ${REPO} or any other worktree.
- The spec is the "Boxfire Art and Feel Bible" at ${BIBLE} (your worktree has the same file at docs/bible.md). Your workstream's section of its BUILD PLAN (§8) says which files you own. Its contract commit C0 (§8.0 rule 1) is already on main and in your branch: commit 72121e6 added POWERS, POWER_PADS, POWER_COLORS, the movement knobs, the BUBBLE, NITRO and SLOWED flags (PU_SHIELD and PU_NITRO alias them for now), POWER_IDS, ENT, the pink slot swap and shared/palette.test.js.
- These overrides beat the bible:
  - §8.0 rules 2 and 4: wire your own rows of the §8.9 integration checklist yourself, as committed edits to client/main.js, client/render.js and client/net.js, so your work runs end to end in your worktree and your critic can see it. Mark every such edit with a "// ${w.name}:" comment. Keep them thin (one call into your module beats logic in main.js), and never reformat or move code you do not need to change: an integrator merges eight branches.
  - The bible's API sections and its descriptions of "today's" code were drafted against an older code base, before the engine wave. Where they differ from current main, current main wins for compatibility: keep every export that main.js and the other modules use working, or update the caller with a marked edit. Implement the bible's features and numbers on top.
  - Screenshots: use 960x540 while iterating; 1280x720 is fine for the final acceptance stills.
- main already holds an engine for every workstream, merged from an earlier wave that worked from a draft. Bring yours to the bible's spec (its look, numbers and missing features) and keep what already meets it; do not rewrite for the sake of it.
- Commit early and often, with the checks passing: this machine rebooted mid-run once and every uncommitted change was lost.
- Scratch files (debug scripts, steps files, notes) go under ${W}/tmp/${w.name}/ only, never in the repo, the harness or another worktree. Pass steps files to smoke.mjs by absolute path.
- Known open items for your workstream, from the last integration: ${(args.open[w.name] || ['none']).join(' | ')}
- Every check must pass before each commit: REPO=${W}/ws/${w.name} PORT=${w.port} ${H}/all.sh (syntax, npm test, the in-process server checks and the live netcode checks). Add tests for new shared logic. Never break the game: it must still start, join, play and shoot.
- No CDN or external requests: generate assets in code, or vendor small files. Respect your draw-call and triangle limits. Avoid per-frame allocations in hot paths.
- Check your work visually.
  - Fixed-angle screenshots: REPO=${W}/ws/${w.name} PORT=${w.port} BOTS=4 OUT=${W}/shots/${w.name} VIEW=960x540 ${H}/serve.sh ${H}/pw/shots.mjs <prefix>
  - Then view them with the Read tool, and compare against ${W}/shots/before-*.png (the first build) and ${W}/shots/engine-*.png (current main).
  - For interactions, write a steps file and use ${H}/pw/smoke.mjs with VIEW=640x360 (see ${H}/pw/README.md and the existing steps*.mjs files).
  - Headless Chromium renders on SwiftShader (CPU), so its fps says nothing about a real GPU. Judge cost by draw calls and triangles from the ?debug stats line (renderer.info), and by per-frame work and allocations.
  - The machine is shared by eight builders: keep headless runs short, use the small viewports above, and take only the screenshots you need.
- The user found the first build "bland, no style, no soul" and wants it "stunning", inspired by popular games (Krunker, Voxiom, Valorant, Teardown, Minecraft with shaders, and Blur for power-ups), while holding 60 fps at 1080p on an Iris Xe iGPU. Be your own harshest critic, and iterate on what the screenshots show.
- Commit on your branch with clear messages. End each message with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>. Never push. Never commit screenshots or node_modules.`

const buildPrompt = (w) => `You are the builder for the "${w.name}" workstream of the Boxfire visual, feel and power-up overhaul. Boxfire is a browser LAN FPS built on three.js r186, a Node.js server and shared deterministic simulation code.
${rules(w)}

First read ${BIBLE} in full: the vision, then your workstream's section, then the integration checklist. Then read the code you own, plus the code around it. Then build your workstream to the bible's spec and acceptance criteria. Finish with tests, screenshots and a commit, and return the structured summary.`

const critiquePrompt = (w, summary) => `You are an adversarial critic reviewing the "${w.name}" workstream of the Boxfire overhaul. Default to finding problems: your job is to stop anything mediocre, broken, slow or off-spec from merging.
The spec is ${BIBLE}: read the vision and the "${w.name}" section. The work is on branch ws/${w.name} in the worktree ${W}/ws/${w.name}. See it with: git -C ${W}/ws/${w.name} diff main...HEAD
The builder's summary:
${JSON.stringify(summary, null, 1)}

Check:
(a) every acceptance criterion in the bible;
(b) visual quality: view the screenshots with the Read tool, compare them with ${W}/shots/before-*.png (the first build) and ${W}/shots/engine-*.png (current main), and judge whether it looks genuinely stunning and cohesive or still bland;
(c) performance: draw calls, triangles, per-frame allocations, anything that would hurt an Iris Xe at 1080p (headless fps is SwiftShader on the CPU and means nothing);
(d) bugs and edge cases, plus anything that breaks the game or the netcode;
(e) file-ownership violations;
(f) the known open items handed to the builder: ${(args.open[w.name] || ['none']).join(' | ')}

Run every check: REPO=${W}/ws/${w.name} PORT=${w.port} ${H}/all.sh. Any failure is a must_fix.
You may run the game yourself, with short headless runs:
REPO=${W}/ws/${w.name} PORT=${w.port} BOTS=4 OUT=${W}/shots/${w.name}-critic VIEW=960x540 ${H}/serve.sh ${H}/pw/shots.mjs critic
Do NOT edit files. Return only real, evidenced findings.`

const fixPrompt = (w, summary, critique) => `You are the builder for the "${w.name}" workstream of the Boxfire overhaul, back to address an adversarial critique.
${rules(w)}

Your previous summary:
${JSON.stringify(summary, null, 1)}

The critique:
${JSON.stringify(critique, null, 1)}

Fix every must_fix item. If one is wrong, say why with evidence instead. Take the nice_to_have items that are cheap and clearly worth it. Then re-verify (npm test, plus screenshots viewed with Read), commit, and return the updated structured summary. Its open_issues should list anything you deliberately left.`

const results = await pipeline(
  args.workstreams,
  (w) => agent(buildPrompt(w), { label: `build:${w.name}`, phase: 'Build', schema: SUMMARY_SCHEMA }),
  (summary, w) => agent(critiquePrompt(w, summary), { label: `critique:${w.name}`, phase: 'Critique', schema: CRITIQUE_SCHEMA })
    .then((critique) => ({ summary, critique })),
  ({ summary, critique }, w) => {
    if (!critique || !critique.must_fix.length) return { name: w.name, summary, critique, fixed: null }
    return agent(fixPrompt(w, summary, critique), { label: `fix:${w.name}`, phase: 'Fix', schema: SUMMARY_SCHEMA })
      .then((fixed) => ({ name: w.name, summary, critique, fixed }))
  },
)

const done = results.filter(Boolean)
log(`${done.length} of ${args.workstreams.length} workstreams finished; ${args.workstreams.length - done.length} dropped`)
return done
