# ChatRightNow

A Windows desktop app where pixel-art animal characters roam your wallpaper and
**people who are online right now** chat with each other in real time via speech
bubbles.

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
  shared/    crypto · protocol · world (dead reckoning)   pure logic, easy to test
  net/       signaling (adapter) · mesh (WebRTC full mesh)
  main/      Electron main (transparent click-through overlay) · preload
  renderer/  world loop · input · chat · sprite drawing
tools/       gen-sprites · build (esbuild) · dev · dev-signal-server (local WS)
assets/      sprites.png / sprites.json (regenerate with npm run gen:sprites)
```

## Signaling backends

Switch with a single line in `config.json` (`"signaling"`). The adapter interface
(`src/net/signaling.js`) is identical, so the rest of the code is unchanged.

- `"supabase"` (default) — zero server deployment. Presence provides the room
  roster; Broadcast carries the SDP/ICE exchange. Requires `supabase.url` /
  `supabase.anonKey`.
- `"local"` — no account needed. Run `npm run signal` to start a local WS server.

## Running

Use Windows, Git, and Node.js with npm. Start with local signaling for development;
no Supabase account or production credentials are needed.

```powershell
npm ci
Copy-Item config.example.json config.json
```

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
4. Run `npm run build` and `git diff --check`. There is currently no automated
   test suite. For behavior changes, also test the affected flow manually:
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

For bug reports, include reproduction steps, expected/actual behavior, Windows
and app versions, and sanitized logs. Do not post credentials or private data.
For a vulnerability, use GitHub's private vulnerability reporting option if it
is enabled; otherwise request a private contact channel without publishing
exploit details or sensitive information.

## Controls

- **Arrow keys / WASD** — move
- **Enter** — open the chat input (Enter again to send, Esc to cancel)
- **Ctrl+Alt+C** — give the overlay keyboard focus (empty space passes clicks
  through to the desktop, so the window may not be focused otherwise)
- Tray icon → Quit to exit

Hover the cursor over a character and only that region captures the mouse (and
grabs focus); empty space passes clicks straight through to the real desktop and
other windows.

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
