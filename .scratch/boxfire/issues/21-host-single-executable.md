# 21: Host as a single executable

**What to build:** The host runs one file instead of installing Node.js.

**Blocked by:** 01 (best done last)

**Status:** ready-for-agent, after the art pass lands. Research done on 13/10/2026: see `../research-21-single-executable.md`. Chosen approach: `bun build --compile` with Bun pinned to 1.4.3. That is four lines in `server/index.js` (finding the root, plus a message-size guard because Bun's `ws` ignores `maxPayload`), two npm scripts, and a pinned Windows runtime. Node SEA is the fallback; its prototype works but needs an alpha injector, an exact node.exe match, and about 3 GB of RAM per build.

Needs human review before the Windows test: allowing the exe through Windows Defender Firewall (a firewall rule change under InCorp_SG policy), and any code-signing certificate (a credential).

- [x] Research written up, with an approach chosen.
- [ ] A Windows host can start a game from the single file.
