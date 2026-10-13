export const meta = {
  name: 'boxfire-single-exe-research',
  description: 'Ticket 21: compare Node single-executable applications with bun build --compile for the Boxfire host, with working proofs of concept',
  phases: [
    { title: 'Prototype', detail: 'one agent per packaging route, each with a proof of concept' },
    { title: 'Compare', detail: 'skeptical comparison and a recommendation' },
  ],
}

const S = args.scratch
const REPO = args.repo

const COMMON = `Context: Boxfire is a browser LAN FPS. The host runs "node server/index.js" from ${REPO} (Node >= 22.15, "type": "module", one dependency: ws). server/index.js serves client/ and shared/ from disk with node:http (MIME map: html, js, json) and reads shared/maps/arena_01.json; the client is plain ES modules plus vendored three.js in client/vendor/. Ticket 21 (${REPO}/.scratch/boxfire/issues/21-host-single-executable.md, read it): the host should run one file instead of installing Node.js, and a Windows host must be able to start a game from it.
Rules:
- The repo is READ-ONLY for you. Copy what you need into your own folder under ${S} and work there.
- Dev-time downloads are fine (npm packages, a Node or Bun binary) as long as they stay inside your folder: no global installs, no sudo, no curl | sh into the system.
- Never run a Windows .exe from WSL: it would start a listening server on the Windows host and could raise a firewall prompt, and InCorp_SG policy routes firewall changes to human review. Building a Windows binary is fine.
- Any server you start for testing listens on a port from your range only, and you stop it afterwards.
- Measure, don't guess: binary size, build time, cold start to "listening", and whether a headless client can load the page and the map from the packaged binary (curl the HTML, a JS module and the map JSON).`

const ROUTES = [
  { key: 'node-sea', dir: `${S}/sea-poc`, ports: '3141-3144', prompt: `Route: Node.js single executable applications (SEA), using the Node already installed here (check node --version). Find out from the official docs for that version whether the entry point may be an ES module or must be CommonJS, whether --build-sea exists or postject is needed, and how assets work (the sea config "assets" field and node:sea getAsset / getRawAsset). Bundle server/index.js with ws into one file (for example with esbuild from npx, inside your folder), embed client/, shared/ and the map as assets, and serve them from memory. Build a Linux binary and prove it end to end. Then build the Windows x64 binary from Linux if the route allows it (download the official node.exe of the same version into your folder) and report exactly what it takes, without running it.` },
  { key: 'bun-compile', dir: `${S}/bun-poc`, ports: '3145-3148', prompt: `Route: bun build --compile. Get a Bun binary into your folder (for example the "bun" npm package via npm install in your folder, or the official release zip), never system-wide. Find out how Bun embeds static files (import with { type: "file" }, Bun.file, embedded asset globs) and whether ws and node:http work under Bun. Make the host serve client/, shared/ and the map from the compiled binary, with as few source changes as possible, and list them. Build a Linux binary and prove it end to end, then cross-compile with --target=bun-windows-x64 and report size and caveats, without running it.` },
]

const FINDINGS = {
  type: 'object',
  properties: {
    works_linux: { type: 'boolean' },
    windows_build: { type: 'string', description: 'how the Windows binary was produced, or why not' },
    size_mb: { type: 'number' },
    cold_start_ms: { type: 'number' },
    build_steps: { type: 'string', description: 'exact copy-paste commands, numbered' },
    source_changes: { type: 'string', description: 'changes the repo would need, as a unified diff or a precise list' },
    caveats: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'commands run and their key output' },
  },
  required: ['works_linux', 'windows_build', 'size_mb', 'cold_start_ms', 'build_steps', 'source_changes', 'caveats', 'evidence'],
}

phase('Prototype')
const results = await parallel(ROUTES.map((r) => () =>
  agent(`${COMMON}\n\nYour folder: ${r.dir}. Your ports: ${r.ports}.\n${r.prompt}\nReturn your measured findings.`, { label: `poc:${r.key}`, phase: 'Prototype', schema: FINDINGS })
    .then((f) => ({ route: r.key, ...f }))))

phase('Compare')
const writeup = await agent(`${COMMON}

Two engineers prototyped ways to ship the Boxfire host as one file. Their measured findings:
${JSON.stringify(results.filter(Boolean), null, 1)}

Be skeptical: re-run the key commands in their folders (${S}/sea-poc and ${S}/bun-poc) to confirm the claims that decide the choice, on ports 3149-3150. Then write the research for ticket 21 as markdown:
1. Recommendation and why, in a few lines.
2. Comparison table: Windows build from Linux, size, cold start, source changes, dependency risk, maturity.
3. Exact build steps for the chosen route, numbered and copy-paste ready, plus the npm script or tools/ file the repo would gain.
4. What a Windows host does to run it: the SmartScreen warning for an unsigned exe, the firewall prompt (flag it: a firewall rule change needs human review under InCorp_SG policy), and how the LAN URL is printed.
5. Risks and open questions.
Use Singapore date format (DD/MM/YYYY); today is 06/10/2026. Return only the markdown.`, { label: 'compare', phase: 'Compare' })

return { results, writeup }