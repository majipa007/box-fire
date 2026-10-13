# 21: Host as a single executable

**What to build:** The host runs one file instead of installing Node.js.

**Blocked by:** 01 (best done last)

**Status:** built on 13/10/2026; waiting on the Windows acceptance test, which needs a person. Approach from `../research-21-single-executable.md`: `bun build --compile` with Bun pinned to 1.4.3 (the Windows runtime in `.cache/bun-win`, SHA256 095db4ab…f543f6). `npm run build:exe` and `npm run build:exe:win` build `dist/boxfire` and `dist/boxfire.exe`. Checked on the Linux binary, started from an empty folder: verify01 passes, a browser smoke with three bots plays with no console problems, and a 5,000-byte message is closed with 1009. Node SEA is the fallback.

Needs human review before the Windows test: allowing the exe through Windows Defender Firewall (a firewall rule change under InCorp_SG policy), and any code-signing certificate (a credential).

- [x] Research written up, with an approach chosen.
- [x] Both binaries build, and the Linux one passes the release check (research §3 step 6).
- [ ] A Windows host can start a game from the single file (research §4, after the firewall review).
