# Ticket 21: run the host from a single file (research)

13/10/2026 · re-checked on ports 3149–3150 · work folder `/home/sukuna/personal_projects/boxfire-work/research-21`

## 1. Recommendation

**Use `bun build --compile` with Bun pinned to 1.4.3.**

- **Why Bun:**
  - One command builds the Windows exe on Linux in about 1 s.
  - It needs no build script, no new npm dependency, and four changed lines in `server/index.js`.
  - Rebuilds come out byte-identical.
  - The exe has no signature at all, rather than a broken one.
- **What it costs:**
  - The host then runs on Bun, not on the Node 24 that the 154 tests use.
  - One difference has already turned up: Bun's built-in `ws` ignores `maxPayload`. A guard in the server handles it.
  - The Windows asset path has only been checked by looking at strings inside the exe.
- **Why not Node's built-in single-executable feature (SEA):**
  - It has the better Windows evidence: the same runtime as the tests, and its path logic was simulated with Windows path rules.
  - On Node 24, though, it needs:
    - a 55-line build script;
    - postject, an alpha injector last published on 19/05/2023;
    - a node.exe that exactly matches the build machine's Node version;
    - 77 s and 2.9 GB of RAM per build.
  - It also produces an exe with a corrupt signature.
- **Size and cold start don't decide it.**
- **Fallback:** if the Windows acceptance test fails, the SEA prototype is ready in `boxfire-work/sea-poc`. Look at SEA again when the repo moves to Node ≥ 25.5, which adds `--build-sea` and an ES module entry point.

## 2. Comparison

| | Node SEA (v24.16.0 + esbuild + postject) | Bun 1.4.3 `build --compile` |
|---|---|---|
| Windows build from Linux | Yes. Needs the official `node.exe` of exactly the build machine's version (v24.16.0), pinned by SHA256. Code cache and snapshot must be off. | Yes, built in (`--target=bun-windows-x64`). The Windows runtime `bun.exe` comes from `npm pack @oven/bun-windows-x64@1.4.3`, and npm checks its integrity. |
| Build time and peak RAM (re-run at load average 21–25 on 12 cores) | 77.1 s in total, of which 70.7 s is the exe injection. 2.88 GB peak. | Compile takes 0.9 s for Linux and 1.2 s for Windows, at 0.20 / 0.31 GB peak. Through the npm script: 3.3–4.9 s once Bun is cached, 33 s on the first run while npx downloads Bun. |
| Windows exe size | 95,002,624 B (95.0 MB) | 98,928,128 B (98.9 MB; 45.2 MB gzipped) |
| Linux binary size | 126,094,528 B (126.1 MB) | 93,345,760 B (93.3 MB) |
| Cold start to "Boxfire is running" (Linux, warm cache, 4 interleaved rounds of 5 runs) | medians 136–192 ms | medians 93–137 ms (plain `node server/index.js` in the same rounds: 229–440 ms) |
| Source changes | About 10 lines in `server/index.js` (a `node:sea` `getAsset` branch for static files and the map). New `tools/build_sea.js` (55 lines). Dev dependencies `esbuild` and `postject`. A step to fetch node.exe. `.gitignore`. | `server/index.js`: 2 lines to find the root and 2 lines to cap message size. Two npm scripts. `.gitignore`. No dev dependencies and no build script. |
| Runtime compared with the tests | Same Node 24 and the same npm `ws` 8.22 that the tests run on | Bun's engine (JavaScriptCore) plus Bun's own built-in `ws`; npm `ws` is not used. `maxPayload` is ignored, so the guard is needed. |
| Dependency risk | esbuild 0.28.2 is stable. postject 1.0.0-alpha.6 was last published on 19/05/2023. The node.exe version must match, and a Linux build cannot check that. | Bun pinned to 1.4.3 through npx: a 90 MB tool from a single vendor. `--compile-executable-path` works but is not on the docs page; only the API's `executablePath` is. |
| Maturity | SEA is at Stability 1.1 (active development). On Node 24 the entry point must be CommonJS and postject is required. Node ≥ 25.5 adds `--build-sea`. The current docs (v26.11.1) also list `mainFormat: "module"` and a virtual file system (v26.9, Stability 1.0). | `--compile`, the cross-compile targets and `--asset <dir>` are documented features. |
| Exe signature (re-run, PE certificate table) | node.exe's old certificate table is left pointing into the injected data, so the signature is invalid ("corrupt") | No certificate table, so the exe is plainly unsigned |
| Windows evidence (neither exe was run) | The asset keys work under Windows path rules: `win_sim` was re-run and passes | Finding the root relies on Bun's `B:/~BUN/root` embedded path, which was only seen as strings inside the exe |
| Reproducible build | Only from a fixed working directory: esbuild writes paths relative to it into comments. A rebuild from another directory gave a different blob; setting `absWorkingDir: root` would fix that. | Byte-identical across 3 rebuilds from 2 different source folders |

Size and cold start don't separate the routes: the exes are about 4 MB apart, and both start in under 200 ms, faster than plain node. The prototypes reported 27 ms for SEA and 36 ms for Bun, but those came from different sessions, and the order flipped in my interleaved re-run.

**Re-run on 13/10/2026** (ports 3149–3150; every server was stopped afterwards and `ss -ltn` showed both ports free):
- **Content check.** Both Linux binaries were started from an empty folder. For every html, js and json file under `client/` and `shared/`, I checked status, Content-Type and sha256 against the source.
  - Bun: 40 files byte-identical (2,502,258 B).
  - SEA: 26 files byte-identical. The 14 `*.test.js` files return 404 because the build leaves them out.
- **Key URLs, the same on both:**
  - `/`: 200 text/html, 7,255 B
  - `/main.js`: 200 text/javascript, 18,274 B
  - `/shared/maps/arena_01.json`: 200 application/json, 3,003 B
- **Bad URLs and WebSocket:** five path-traversal and unknown URLs returned 404. A WebSocket join got `welcome id=1 map=arena_01 tickRate=60`. A 5,000-byte frame was closed with code 1009 on both.
- **Repo harness:** `.scratch/harness/verify01.mjs` against the Bun binary printed `static ok` and `lobby ok`.
- **Tests:** `node --test` on a repo copy with the Bun change passed 154/154.
- **SEA Windows simulation:** `win_sim` passes the same checks.
- **Method:** the permission system denied curl, so these checks used Node `fetch` with a sha256 comparison.

**Cited from the prototypes, not re-run:**
- the headless Chromium smoke test on both binaries (`problems: []`);
- Bun's heartbeat probe and its frame-size table;
- the stripped SEA Linux binary (108.4 MB);
- `verify01` against the SEA binary.

## 3. Build steps (Bun)

Run these from the repo root on Linux x64 with Node ≥ 22.15 and npm.

1. Change `server/index.js`:

```diff
-const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
+// In a `bun build --compile` binary this module reports the executable's own
+// path, with client/ and shared/ embedded beside it.
+const here = path.dirname(fileURLToPath(import.meta.url));
+const root = fs.existsSync(path.join(here, 'client', 'index.html')) ? here : path.resolve(here, '..');
@@
-const wss = new WebSocketServer({ server, maxPayload: 4096 });
+const MAX_MSG = 4096;
+const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
@@
   ws.on('message', (data, isBinary) => {
+    // Bun's built-in ws ignores maxPayload (it caps frames at 16 MiB), so check again.
+    if (data.length > MAX_MSG) return ws.close(1009);
     const msg = isBinary ? null : decodeClient(String(data));
```

2. Add these to `"scripts"` in `package.json`, exactly as tested:

```json
"build:exe": "npx --yes bun@1.4.3 build --compile --asset client --asset shared --no-compile-autoload-dotenv --no-compile-autoload-bunfig server/index.js --outfile dist/boxfire",
"build:exe:win": "npx --yes bun@1.4.3 build --target=bun-windows-x64 --compile-executable-path=.cache/bun-win/package/bin/bun.exe --compile --asset client --asset shared --no-compile-autoload-dotenv --no-compile-autoload-bunfig server/index.js --outfile dist/boxfire.exe"
```

3. Add these lines to `.gitignore`:

```
dist/
.cache/
```

4. Fetch the pinned Windows runtime once. npm checks the registry's integrity hash.

```sh
mkdir -p .cache/bun-win && cd .cache/bun-win
npm pack @oven/bun-windows-x64@1.4.3
tar -xzf oven-bun-windows-x64-1.4.3.tgz
sha256sum package/bin/bun.exe   # expect 095db4abae203d42f29fdec26da4a882fcde6333cdd84e40c0c7828c0cf543f6
cd ../..
```

5. Run the tests, then build both binaries:

```sh
npm test                 # 154/154
npm run build:exe        # dist/boxfire      93,345,760 B
npm run build:exe:win    # dist/boxfire.exe  98,928,128 B
sha256sum dist/boxfire.exe   # 13/10/2026 tree: 6da70fdb8027747c832d616f64938384d06534e88e1b048c6a429e5b5eedcbbc
```

6. Check the release on the Linux binary. It is the same Bun code. Use a fresh instance for each harness script, because one run leaves the game in "playing".

```sh
PORT=3100 ./dist/boxfire & pid=$!
sleep 1; PORT=3100 node .scratch/harness/verify01.mjs; kill $pid
```

7. Give `dist/boxfire.exe` and its SHA256 to the Windows host.

Notes:
- **Keep both `--no-compile-autoload-*` flags.** Without them the exe would load `.env` and `bunfig.toml` from whatever folder it starts in, and a `bunfig.toml` can preload scripts.
- **Don't add bun as a devDependency.** Every `npm install` would then pull about 90 MB.
- **Recommended, not required:** the EADDRINUSE hint `PORT=3001 npm start` is wrong for the exe. Make it platform-neutral, for example: ``Port ${port} is already in use. Stop whatever is using it, or set the PORT environment variable to another port (for example 3001).``

## 4. Running it on a Windows host

1. **Copy and check.** Put `boxfire.exe` in a folder such as `C:\Games\Boxfire\`, then check its hash in PowerShell. It must match the published value:
   `Get-FileHash C:\Games\Boxfire\boxfire.exe -Algorithm SHA256`
2. **First run from a terminal.** That way errors stay readable; a double-clicked window closes as soon as the program exits with an error.
   - PowerShell: `cd C:\Games\Boxfire; .\boxfire.exe` (port 3000), or `$env:PORT=3001; .\boxfire.exe`
   - cmd: `set PORT=3001`, then `boxfire.exe`
   - After that a double-click is fine and uses port 3000. Closing the window stops the game.
3. **SmartScreen.** The exe is unsigned; I confirmed it has no certificate table.
   - If the file was downloaded through a browser, Teams or email, Windows marks it as coming from the internet. It then shows "Windows protected your PC … Unknown publisher".
   - Choose **More info → Run anyway**, but only after the hash check. Don't turn SmartScreen off.
   - A copy made over USB or a network share may not show the warning.
   - If Smart App Control is on (Windows 11), it may block an unsigned app with no way to override it. Only code signing fixes that (see section 5).
4. **Windows Defender Firewall prompt: human review required.** Under InCorp_SG policy this is a firewall rule change. On the first listen, Windows asks whether to allow `boxfire.exe` on Private and/or Public networks. Nobody clicks Allow until the review is done.
   - **Least privilege:** allow Private networks only, never Public. If the WiFi is classed as Public, set that network's profile to Private (also a change that needs review) rather than ticking Public.
   - **If access is denied or the prompt is cancelled:** the host can still play at `http://localhost:3000`, because loopback traffic isn't filtered, but friends can't connect.
   - **The prompt's rule is broad:** it allows the program on any port from any address on that profile. Here is a tighter rule for the reviewer. **Do not run it without approval:**

     ```powershell
     New-NetFirewallRule -DisplayName "Boxfire_Host_LAN" -Direction Inbound -Action Allow `
       -Program "C:\Games\Boxfire\boxfire.exe" -Protocol TCP -LocalPort 3000 `
       -Profile Private -RemoteAddress LocalSubnet
     # remove after the session
     Remove-NetFirewallRule -DisplayName "Boxfire_Host_LAN"
     ```
5. **LAN URL.** On start the console prints:

   ```
   Boxfire is running. Share one of these with friends on the same WiFi:
     http://<LAN IPv4>:3000
   On this machine: http://localhost:3000
   ```

   - It prints one line for each IPv4 address that is not internal.
   - A host with WSL, Hyper-V, Docker or a VPN also lists those virtual or VPN addresses; the Linux test machine printed two. Share the WiFi adapter's address: in `ipconfig`, look under "Wireless LAN adapter Wi-Fi".
   - The host plays at `http://localhost:3000`. The server makes whoever connects through localhost the host of the game.

**Acceptance test for checkbox 2.** A person does this on a Windows 10/11 x64 PC, after the firewall review: steps 1–5, then a second device opens the LAN URL and joins, and the host starts a match.

## 5. Risks and open questions

1. **The exe has never run on Windows** (by rule). Checkbox 2 stays open until the acceptance test passes.
   - If startup fails with ENOENT on `shared\maps\arena_01.json`, Bun's Windows root is not `B:\~BUN\root`.
   - Then try `import.meta.dirname`. Bun's docs read `--asset` files from `import.meta.dir`; this is untested.
   - Otherwise fall back to the SEA prototype.
2. **Bun is not the runtime the tests use.** The tests run on Node; the exe runs Bun with its own `ws`.
   - The same as Node, per the prototype: a silent client is dropped at 5.2–5.7 s (Node: 5.4 s), pongs keep a client alive, EADDRINUSE is reported, and the localhost host is still detected.
   - Different: `maxPayload` is ignored, which the guard handles. Even with the guard, Bun takes in a whole frame of up to 16 MiB before closing the connection, while Node rejects it from the frame header. That is acceptable on a LAN.
   - Mitigation: run step 6 of section 3 on every build.
3. **Signing.**
   - An unsigned exe triggers SmartScreen, and Smart App Control may block it outright.
   - A cross-compile can't set an icon, title, version or publisher; those flags work only when building on Windows.
   - Signing needs a code-signing certificate. That is a credential, so it needs human review. I did not research the cost.
   - I did not measure how long Defender's first scan of a 99 MB exe takes.
4. **Firewall:** see section 4. It needs human review.
5. **Undocumented flag.** `--compile-executable-path` is not on the current docs page. If a later Bun drops it, remove the flag and let Bun download the runtime itself. That writes to `~/.bun` and is untested.
6. **Older CPUs.**
   - The prototype said Bun's x64 build needs AVX2. The current docs disagree: they say one x64 binary targets SSE4.2 and picks AVX2 at runtime, and that the `-baseline` suffix is still accepted only for backward compatibility.
   - `@oven/bun-windows-x64-baseline@1.4.3` does exist on npm.
   - Not tested on an old CPU.
7. **Version pin.** 1.4.3 is the latest Bun on npm (modified 12/10/2026). The `--asset` behaviour and Bun's `ws` differ between versions, so repeat step 6 after any upgrade.
8. **Download size.** Each copy is about 99 MB (45 MB gzipped). Almost all of that is the runtime; the game files are about 2.5 MB.
9. **Served files.** All 40 html, js and json files are served, including `*.test.js`. That matches running from disk under Node.
10. **SEA later.**
    - The ticket's "ES module entry point" is not possible on Node 24, which only runs a CommonJS entry.
    - Node ≥ 25.5 adds `node --build-sea`, which removes the need for postject, and the docs list `mainFormat: "module"`.
    - The docs don't say whether its `executable` field can inject into a Windows `node.exe` from Linux, and I didn't test it.
    - Look again once the repo moves to Node 26, the next LTS line.
    - A SEA exe would also need its stale certificate table cleared (zero PE data directory 4 in the node.exe copy before injecting) to come out plainly unsigned.

**Files:**
- `/home/sukuna/personal_projects/boxfire-work/research-21`:
  - `check.mjs`, `pe_sig.mjs`, `bun_build.sh`
  - `repo/`: a repo copy with the change and the scripts; `repo/dist/` holds the built binaries
  - `sea-out/`
  - `logs/sea-build.log`
- Prototypes: `/home/sukuna/personal_projects/boxfire-work/sea-poc` and `/home/sukuna/personal_projects/boxfire-work/bun-poc`