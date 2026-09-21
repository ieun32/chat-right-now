# ChatRightNow

A Windows desktop app where pixel-art animal characters roam your wallpaper and
**people who are online right now** chat with each other in real time via speech
bubbles.

- **No history.** Nothing is delivered to offline users, and no logs pile up. You
  only ever see chat from people currently attached to the mesh.
- **Peer-to-peer.** Chat and positions travel directly over a WebRTC DataChannel
  full mesh. The server only tells you "who is in the room right now" and relays
  the WebRTC handshake (signaling).
- **End-to-end encrypted.** A room session key (`nacl.secretbox`) is sealed to
  each member's public key and shared out; messages are encrypted with that key.
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

```bash
npm install
npm run gen:sprites          # generate the sprite sheet (once; already committed)

# A) Local (no account): set "signaling":"local" in config.json, then
npm run dev                  # signaling server + watch build + Electron together

# B) Supabase: fill url/anonKey in config.json, then
npm start
```

Packaged build:

```bash
npm run dist                 # Windows NSIS installer via electron-builder
```

## Controls

- **Arrow keys / WASD** — move
- **Enter** — open the chat input (Enter again to send, Esc to cancel)
- **Ctrl+Alt+C** — give the overlay keyboard focus (empty space passes clicks
  through to the desktop, so the window may not be focused otherwise)
- Tray icon → Quit to exit

Hover the cursor over a character and only that region captures the mouse (and
grabs focus); empty space passes clicks straight through to the real desktop and
other windows.
