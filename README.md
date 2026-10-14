# ChatRightNow

A Windows and macOS desktop app where pixel-art animal characters roam your wallpaper and
**people who are online right now** chat with each other in real time via speech
bubbles.

## Download and updates

Desktop installers are distributed through
[GitHub Releases](https://github.com/ieun32/chat-right-now/releases/latest).
Windows: choose `ChatRightNow-Setup-<version>-x64.exe`.
macOS (from v0.3.0): choose `ChatRightNow-<version>-mac-universal.dmg`, open it,
and drag ChatRightNow into Applications. The Universal app supports both Intel
and Apple Silicon Macs. macOS 11 or newer is required. GitHub's source-code
ZIP is not an installer. Mac assets appear once v0.3.0 is published.

The current Mac build is not Developer ID signed or notarized. macOS may block
its first launch; if you trust this release, use System Settings > Privacy &
Security > Open Anyway after attempting to open it. Do not disable Gatekeeper.
Mac builds check for updates at startup, but the download button opens GitHub
Releases for manual installation. In-app installation requires Apple code
signing and is not enabled in this build.

Version **0.2.0** introduces the updater. Install this version manually once if
you are on 0.1.0. Installed builds check the latest stable GitHub release when
the app starts. The join screen and settings menu show your installed version
and update status. Choose **새 버전 다운로드**, then **재시작하여 설치** when ready;
installation closes the app and disconnects the current room. Checking does not
automatically download, and quitting normally does not install an update.
Network errors leave the app usable and can be retried. Development mode does
not query releases. The tray also shows the version and an update-check action.

- **No saved chat history.** The app does not persist chat messages or deliver
  them to offline users. Participants can still record what they receive.
- **Peer-to-peer.** Chat and positions travel directly over a WebRTC DataChannel
  full mesh. The server only tells you "who is in the room right now" and relays
  the WebRTC handshake (signaling).
- **End-to-end encrypted.** A room session key (`nacl.secretbox`) is sealed to
  each member's public key and shared out; messages are encrypted with that key.
  Rooms are public: encryption does not authenticate participants or restrict
  who can join using a room code.
- **Bandwidth-optimized.** Movement sends *only start/stop events* and every
  client interpolates with dead reckoning. Holding a key for 5 seconds costs 2
  packets, not 150.

## Structure

```
src/
  shared/    crypto · protocol · world (dead reckoning) · tower (seed-derived jump map)   pure logic, easy to test
  net/       signaling (adapter) · mesh (WebRTC full mesh)
  main/      Electron main (transparent click-through overlay) · preload
  renderer/  world loop · input · chat · sprite drawing · tower (follow-cam platformer)
tools/       gen-sprites · gen-tiles · build (esbuild) · dev · dev-signal-server (local WS)
assets/      sprites.png + sprites.json (npm run gen:sprites) · tiles.png + tiles.json (npm run gen:tiles)
```

## Signaling backends

Switch with a single line in `config.json` (`"signaling"`). The adapter interface
(`src/net/signaling.js`) is identical, so the rest of the code is unchanged.

- `"supabase"` (default) — zero server deployment. Presence provides the room
  roster; Broadcast carries the SDP/ICE exchange. Requires `supabase.url` /
  `supabase.anonKey`.
- `"local"` — no account needed. Run `npm run signal` to start a local WS server.

## Running

Use Windows or macOS, Git, and Node.js with npm. Start with local signaling for development;
no Supabase account or production credentials are needed.

```powershell
npm ci
Copy-Item config.example.json config.json
```

On macOS, use `cp config.example.json config.json` for the copy step.

In `config.json`, change `"signaling"` to `"local"`, then run:

```powershell
npm run dev
```

This starts the local signaling server, watch build, and Electron. It does not
change your config automatically. The sprite sheet is already committed; run
`npm run gen:sprites` only when regenerating it.

For Supabase, use your own development project, set `"signaling": "supabase"`,
and fill `supabase.url` and `supabase.anonKey` with the project's client key:

```powershell
npm start
```

Packaged build:

```bash
npm run dist                 # Windows NSIS installer via electron-builder
npm run dist:mac             # Universal DMG + ZIP; run on macOS
```

Packaging is for local testing or authorized releases under the [license](LICENSE).
The build copies `config.json` into `dist`, and the installer includes it.
Inspect the configuration before sharing an authorized release; `.gitignore`
does not remove credentials from installers.

## Public rooms and security

Rooms intentionally allow anyone with the room code to join. A room code is a
room identifier, not a password. There is no account login, invitation approval,
or verified participant identity. The shared encryption key is not rotated when
a participant leaves. Do not rely on this app for confidential conversations.

Supabase uses public Realtime channels for Presence and signaling. Disabling
public channels without changing the client and authorization policies prevents
the current app from connecting. Chat messages travel over peer DataChannels;
room membership and connection metadata are handled by the signaling service.
WebRTC peers may learn one another's IP addresses.

- Keep real settings in the ignored `config.json`; commit only placeholder
  values in `config.example.json` or environment templates.
- Never put service-role keys, secret API keys, database passwords, or signing
  keys in source code, client configuration, PRs, screenshots, or installers.
- Client publishable/anon keys are not secrets and do not replace server access
  policies. Use a separate development project when testing Supabase changes.
- The local WebSocket server is a development tool without production access
  controls. Do not expose it to the public internet.

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome.
Read the [license](LICENSE) before contributing. Discuss substantial changes in
an issue first, especially changes to networking, encryption, or user experience.

1. Fork [ieun32/chat-right-now](https://github.com/ieun32/chat-right-now).
2. Clone your fork and create a branch:

   ```powershell
   git clone https://github.com/YOUR-USERNAME/chat-right-now.git
   cd chat-right-now
   git switch -c fix/short-description
   ```

3. Follow the local setup above and make a focused change. Include
   `package-lock.json` when dependencies change. Identify the source and license
   of any third-party code or assets you add.
4. Run `npm run build`, `npm test`, and `git diff --check`.
   For behavior changes, also test the affected flow manually:
   joining/leaving, movement, chat, or overlay controls. For networking changes,
   verify two peers can communicate in the same test room.
5. Review `git diff` and `git status --short` for unintended files or secrets,
   commit the intended files, and push your branch to your fork.
6. Open a PR targeting this repository's `main`. Explain the problem, what
   changed, how you tested it, and any limitations. Include screenshots for
   visible UI changes, with sensitive details removed.

The repository owner reviews and merges accepted PRs. Contributors do not need
write access to submit a PR, and submitting one does not grant merge access.
GitHub repository rules enforce permissions separately from these instructions.

For bug reports, include reproduction steps, expected/actual behavior, OS
and app versions, and sanitized logs. Do not post credentials or private data.
For a vulnerability, use GitHub's private vulnerability reporting option if it
is enabled; otherwise request a private contact channel without publishing
exploit details or sensitive information.

## Controls

- **Arrow keys / WASD** — move
- **Shift + movement** — run (1.8× speed)
- **Space** — jump
- **E** — toggle the radial inventory around your character
- **Click a weapon / 1, 2, 3 while the inventory is open** — equip the
  dokkaebi club, gun, or flamethrower
- **F** — use the equipped weapon in the direction you face
- **Enter** — open the chat input (Enter again to send)
- **Esc** — hide the app while it has keyboard focus; also cancel any open
  chat draft. During IME composition, Esc is left to the input method.
- **Ctrl+Alt+V** — globally toggle hide/show, including bringing the app back
  after Esc. Hiding keeps you connected to the room, but marks your character
  offline with a gray crossed-out Wi-Fi icon for other participants. Showing the
  app restores your online status. Hidden participants can still receive data;
  this indicator describes visibility, not a disconnected network connection.
- **Ctrl+Alt+C** — give the overlay keyboard focus (empty space passes clicks
  through to the desktop, so the window may not be focused otherwise)
- Tray icon → Quit to exit

Hover the cursor over a character and only that region captures the mouse (and
grabs focus); empty space passes clicks straight through to the real desktop and
other windows.

Weapons have different ranges and cooldowns. A hit produces X-shaped eyes,
a tongue-out expression, and orbiting stars, and stops movement/attacking/jumping
for three seconds. Hits do not extend an existing stun. Hidden characters are
excluded from hits. Jumping is a movement animation, not attack immunity.
Gameplay uses peer-reported state and is intended for casual play, not a
server-authoritative competitive game. All participants need this version to
see the new gameplay and availability states.

On macOS, replace **Ctrl+Alt** in the shortcuts above with **Command+Option**
(`⌘⌥`). The menu bar icon opens the app menu; the Dock icon focuses the overlay.
Command+C/V/A and other standard editing shortcuts work in the chat input.
The overlay leaves space for the macOS menu bar and Dock.

## 인내의 숲 — jump-map mode

Tick **🌲 인내의 숲 (점프맵)** on the join card to turn the room into a vertical
"Tower of Hell"-style climb instead of the desktop pet lounge.

- **The room code is the map seed (salt).** It is hashed (FNV-1a) into a seed for
  a deterministic PRNG, so everyone who types the same code generates a
  *byte-identical* tower of platforms. Because the layout is derived, not
  downloaded, it still rides the serverless P2P model — nothing about the map
  ever crosses the wire, only each climber's live position.
- **Per-player follow-camera.** You are anchored ~62% down your own viewport and
  the tower scrolls as you climb; the background stays transparent over your
  desktop. Everyone sees the same tower through their own camera.
- **Controls:** ←→ / A D to move, **Space / ↑ / W** to jump, **F** to attack,
  **1 / 2 / 3** to switch weapon, **Enter** to chat.
- **Live ranking (hold Tab).** Ranks everyone present by the highest floor they
  have reached: the top 10, and — if you are below the cut — a separator plus
  your own row, so you always see where you stand.
- **Knockback.** Platforms are one-way (you can jump up through them). A hit from
  the dokkaebi club / gun / flamethrower shoves you in the attacker's facing
  direction with a small upward pop, and **only an attacker inside your viewport
  can knock you.** If the shove carries you past a platform's edge, you fall and
  lose height — so a well-placed club near a ledge is how you set a rival back.

Pure map generation and physics live in `src/shared/tower.js` (unit-tested in
`tests/tower.test.mjs`); the follow-camera, networking cadence and drawing live
in `src/renderer/tower.js`. The tileset is procedurally generated, transparent
background, by `npm run gen:tiles`. End-to-end coverage (two peers over real
WebRTC: identical seed map, climbing, in-viewport knockback, live ranking) is in
`tools/smoke-tower.cjs` (`npx electron tools/smoke-tower.cjs`).

## Publishing a desktop release (maintainer)

1. Set repository Actions secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
   to the intended public service's URL and client publishable/legacy anon key.
   These values are intentionally readable in the installed client. Never use
   a service-role key or secret API key. The release build rejects those keys
   and includes only the required client settings.
2. Update `package.json` and `package-lock.json` together with
   `npm version <version> --no-git-tag-version`, then commit the release changes.
3. Merge the release PR into main, then push a matching tag such as `v0.3.0`,
   or run **Desktop release** from main in Actions. The workflow tests and
   builds on Windows and macOS, then publishes both platforms together:
   Windows EXE, Mac Universal DMG/ZIP, blockmaps, `latest.yml`, and `latest-mac.yml`.
   A failed platform build prevents publication of a partial release.
4. Verify the download and install the release on a test machine. Keep the
   release public and stable for automatic update discovery. Tags alone and
   draft releases do not make an update available.

For a local release build, `npm run dist -- --x64` uses the client settings in
`config.json` unless the two environment variables above are supplied. It
creates release files without uploading. Upload the matching installer,
blockmap, and `latest.yml` together; do not mix metadata from different builds.
GitHub upload credentials belong in the release job, never in the app.
The current local build is unsigned; Windows may show a publisher warning.
Mac builds use a local ad-hoc signature for Apple Silicon execution, but have
no Apple Developer ID certificate or notarization. The packaging hook verifies
the local signature after merging the two architectures.
To enable native Mac update installation in a future release, configure
Developer ID signing and Apple notarization in CI, then remove the Mac
`manualInstall` restriction in `src/main/main.js` after validating a signed
version-to-version update on a Mac. Never commit certificates or signing secrets.

PR checks run unit tests and the Electron renderer smoke test on Windows and
macOS, and verify Mac Universal packaging using development configuration.
These test packages are not published. A real Mac still needs manual checks
for desktop click-through, menu bar/Dock, Spaces, global shortcuts, and first launch.

Run `npm test` for state/geometry/updater tests. On Windows,
`npx electron tools/smoke-electron.cjs` additionally exercises two real Electron
renderers with local WebRTC, all three weapons, stun recovery, sprint/jump,
availability updates, and update UI. Screenshots are saved under ignored `dist/`.
It does not connect to the production Supabase project or install updates.

## License

ChatRightNow is **source-available, not open source**. The custom
[license](LICENSE) permits personal, noncommercial use and modifications,
including official binary releases, plus source-code forks and pull requests
for contributing to this upstream project. Commercial or business use,
standalone redistribution, third-party binary releases, and hosting a service
for others require prior written permission. See the license for the full terms.

Contributors retain ownership of their work and grant the permissions described
in the license for upstream integration and official noncommercial releases.

### Third-party font

`assets/fonts/DOSMyungjo.ttf` is DOSMyungjo by Damheo Lee (이담허), from
[hurss/fonts](https://github.com/hurss/fonts). It is distributed separately under
its original [MIT license and copyright notice](assets/fonts/LICENSE.txt).
The project's noncommercial restrictions do not apply to this font or to other
third-party components under their own licenses.

The project license and font notice are included in newly packaged builds.
