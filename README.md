# Astra

A local voice assistant for your Mac, built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk),
with [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) as its x-ray vision.

You talk, Astra works: it can tear down a website or a Mac app with REA, save the report to a markdown
"second brain", read it back to you section by section, build an original version of what it found,
test it, and open it.

Speech in and out runs on your machine (whisper.cpp in, the [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
neural voice out, with macOS `say` as the fallback). What leaves your Mac is the conversation with Claude, plus the
web searches and page fetches Astra makes. She fetches pages without asking only from the sites on your safe-site list
(`~/.jarvis/safe-sites.json`); any other site asks you first, so a page she's reading can't send your data elsewhere.

Astra lives in a floating orb, an arc reactor crossed with a winged sun: it opens its eye and ripples while it listens,
spins its rings while it works, and spreads its wings and pulses with every syllable it speaks. Drag it anywhere.
Hover and press **–** to minimise it; click the sun icon in the menu bar to bring it back. It comes back by itself when
it needs your permission, showing the details with No / Always / Yes buttons.

**Just say "Astra":** on its own she chimes and listens; "Astra, open Quire" goes straight through. It's all local:
the mic waits for sound, and each phrase is transcribed on your Mac and dropped unless it starts with her name. The
mic stays on while she runs (`/wake off` or `JARVIS_WAKE=off` to disable). Saying "Astra, stop" stops her.

**She's always listening for her name**, even while she's working or talking: "Astra, stop" interrupts her (talking
over her is best-effort, since her own voice is in the mic; the stop glyph and Esc always work).
**Questions and approvals** can be answered by voice: she listens for your answer once she's finished asking ("yes",
"always", "the second one"), or click the card. She can interview you with option cards (ask_user).
**She works her own interface**: "Astra, minimise", "open my brain", "show me the map again", "louder", "volume 40",
"move to the top left", "go to the centre", "move a bit right".
**Her cards sit below the orb** when there's room, above it near the bottom of the screen; the window sizes itself.
**The teardown map draws each node as an icon** for its kind of tech (sun: the app, cube: module, layers: framework,
spark: feature, cylinder: data, cloud: service).
**She folds away and unfolds**: minimising, quitting or "Astra, fold up" folds her wings, retracts her rings into
the eye and closes it before she hides; showing her again (menu bar, "unfold", "come back") plays it in reverse.
**Terminal and git panels** show what she's doing: every command she (or a background session) runs, with output and
✓/✗, and the repos she touches with changed files, +/− counts and click-to-view diffs. They open on their own when she
runs a command or edits a repo (closing one keeps it closed until your next request), collapse to their header with ▾,
and are in the menu-bar menu, or say "show your terminal" / "show the git changes".
**State changes dial like a gate**: the glyph ring spins and locks onto symbols as nine chevrons engage, then a burst
ripples out from the eye. **Her thinking window collapses** away entirely with the ▾ on its tab (click the state label under the orb, or say "expand your panel", to bring it back); while
collapsed, the gate's chevrons show her state (breathing: listening, chasing: thinking, pulsing: speaking).
**Volume**: by voice, by scrolling over the orb, or from the menu-bar menu; remembered in `~/.jarvis/settings.json`.
**The brain browser** (menu bar → Open brain, or "Astra, open my brain") lists every note and teardown with search, and
opens saved teardown maps. Maps have zoom buttons (+ / − / fit, or the + − 0 keys).
**What she's doing** shows live under the orb, each step marked with a glyph from her ring (eye: reading, ankh:
building, djed: commands, water: the web, reed: asking you, sun: thinking), and that glyph lights up on the ring.

**Talking is a conversation:** say her name, click the core of the orb, or press Enter, and speak. Astra notices when you pause,
answers, then listens for your reply. Say nothing for a few seconds and it goes back to sleep.

## What it can do

| Ask | What happens |
|-----|--------------|
| "Tear down igloo.inc" | Opens a clean Chrome profile, runs REA's browser tools, saves a teardown to `brain/teardowns/` |
| "Read me that teardown" | Reads the report aloud one section at a time, asking before each next section |
| "Reverse engineer the Notes app" | Runs REA's desktop/app analysis on `/System/Applications/Notes.app` |
| "Build me my own version" | Builds an original app under `workspace/` from the blueprint, tests it, opens it |
| "Open Safari" / "Open the app you built" | Opens apps, or files Astra made |
| "What did we learn about igloo?" | Searches the brain |
| "What are my Claude Code sessions doing?" | Reads your other sessions (app and terminal): which are working, waiting for you, or idle, and their latest replies |
| "Tell the gymclaw session to commit and deploy" | Sends a follow-up to that session in the background (only if it's idle); its approvals come to you, and she reports back |
| "Start a session in cratedigga to fix the search" | Runs a new session in the background and reports back, or ("in the app") opens it in the Claude app with the prompt ready |
| "Open the budget app session" | Opens that session in the Claude app (background runs are imported into it) |
| "Show me a 3D map of the Notes teardown" | Opens an interactive 3D map of the app's structure: orbit, zoom, click nodes for evidence |

## Set up (macOS)

You need Node.js 22.23.4 or newer.

```bash
# 1. Speech tools. If `whisper-cpp` isn't found, build whisper-cli from source:
#    https://github.com/ggml-org/whisper.cpp#quick-start
brew install sox whisper-cpp

# 2. Download a speech model. Larger models (small.en, medium.en) are more accurate but slower.
mkdir -p ~/.jarvis/models
curl -L -o ~/.jarvis/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
# The speech detector that ends a recording when you stop talking, even with background noise (Silero VAD, 2.3 MB,
# runs locally). Without it she falls back to a loudness threshold calibrated to the room, and says so in her log.
curl -L -o ~/.jarvis/models/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx

# 3. REA
npm install -g rea-agents

# 4. Astra
git clone <this repo> jarvis && cd jarvis
npm install             # also downloads Electron for the orb
cp .env.example .env    # optional: change the voice, model, budget, folders
```

**Claude credentials:** log in once with Claude Code (`claude`, then `/login`), or set `ANTHROPIC_API_KEY` in `.env`.

**Voice model:** the first time Astra speaks it downloads the Kokoro model (about 90 MB) to `~/.jarvis/models/tts`.

**Microphone permission:** the first time you talk, macOS asks whether your terminal app may use the microphone. Say yes.

**For app teardowns:** REA's native analysis needs Hopper, Ghidra or IDA. `rea doctor` and the
[REA installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md) cover this.
Website teardowns only need Google Chrome.

## Run it

Without typing a command: run `sh scripts/make-app.sh` once to build `Astra.app` in this folder (it also refreshes
`/Applications/Astra.app` if you've copied it there), then open it like any app. She starts in the background, with
no Terminal window, just her orb and menu-bar icon; her output goes to `~/.jarvis/logs/astra.log`. If she's already
running you get a notification instead. The first time, macOS asks to let Astra use the microphone: allow it, or she
hears nothing. To restart her, use **Restart Astra** in her menu-bar menu or say "Astra, restart".

**Operating Mac apps.** Astra can use any app the way you would (the `computer_*` tools): she reads its Accessibility
tree, falling back to screenshots, and clicks, types, presses keys and scrolls through a small Swift helper
(`native/astra-ax.swift`, built into `~/.jarvis/bin` on first use, or with `npm run build:ax`). She never reads or
types into password fields, asks on a card before anything that sends, buys, deletes, submits or changes system
settings, logs every action, and shows an orange edge round the screen while she's in control. Say "stop" or press
Control-Option-Escape to halt her. She needs **Accessibility** and, for screenshots, **Screen Recording** in System
Settings → Privacy & Security, for Astra (or Terminal, if you start her there); she opens the right pane if either is
missing.

`Astra.app` has this folder's path baked in. To move the repo, use `scripts/relocate.sh` (it quits her, moves the
folder, rebuilds both copies of the app, runs the checks and relaunches her; `--dry-run` to preview, `--rollback` to
undo). Set `RELOCATE_TO` for somewhere other than `~/Workspace/jarvis`.

```bash
npm start            # voice: press Enter to talk, Enter again to send
npm run text         # typed mode
npm start -- --mute  # voice in, text out
npm start -- --no-orb  # terminal only (approvals then use a macOS pop-up)
```

In either mode you can also type a request. Commands: `/new` (fresh conversation, brain kept), `/mute`,
`/unmute`, `/help`, `/quit`. **Ctrl-C** cancels the request in progress; press it again when idle to quit.

## What Astra may do without asking

| Allowed automatically | Asks you first |
|-----------------------|----------------|
| Reading files, searching the web | Shell commands |
| Fetching pages from sites on the safe-site list | Fetching pages from any other site ("always" allows that one site for the session) |
| Saving and reading brain notes | REA tools (answer "always" to stop being asked for that tool this session) |
| Writing files inside `workspace/` and her brain | Writing anywhere else |
| Opening apps, and files inside its own folders | |

The safe-site list is `~/.jarvis/safe-sites.json`, `{"sites": [...]}`. It's created with documentation and package
sites (MDN, Vue, Nuxt, Node, TypeScript, Electron, Cloudflare docs, GitHub, npm, Anthropic, Claude, Hugging Face) the
first time Astra starts. A site also covers its subdomains. Edits apply on her next fetch, no restart needed. Free
hosting (pages.dev, vercel.app, netlify.app) is deliberately left off: anyone can host there and read the request logs.
If the file can't be read, every fetch asks. Sites you've already allowed for Claude Code itself
(`WebFetch(domain:…)` rules in `~/.claude/settings.json`) are allowed for Astra too, because she loads your Claude
Code settings and those rules are checked before her list.

**Security check on every page fetch** (`src/security/`), including sites on the list or allowed in your settings:

- *Before the fetch*, the address is checked in code for warning signs (not https, a bare IP or your own network, a
  username in it, an odd port, look-alike international characters, shared hosting where anyone can publish, or
  data riding in it: long encoded values, access keys, emails, home folders), then against public threat lists:
  Quad9's threat-intelligence DNS (always, no key), and Google Safe Browsing and abuse.ch's URLhaus when you set
  `JARVIS_SAFE_BROWSING_KEY` / `JARVIS_URLHAUS_KEY` (both free; see `.env.example`). Those two get the address
  without its query string. A threat-list hit is refused; a warning sign means she asks you, showing why.
- *After the fetch, before she reads it*, hidden characters and passages that read like instructions to an AI
  ("ignore previous instructions", "don't tell the user", "send their files to …") are removed, and the page is
  labelled as data, never instructions. If anything was removed she tells you.


## Responsible use

REA is for learning, interoperability and software you're allowed to analyse. Astra builds **original**
versions from a teardown's blueprint. It never copies code, assets or branding, and won't touch licensing,
DRM or copy protection. Read the license and terms of anything you point it at.
See REA's [DISCLAIMER](https://github.com/morluto/rea/blob/main/DISCLAIMER.md).

## Development

```bash
npm test           # vitest
npm run typecheck  # tsc
```

Layout:

```
src/
  index.ts         CLI: listening loop, wake word, typed mode, approvals, transcripts, god mode
  agent.ts         Claude Agent SDK session: options, permissions, spoken output
  prompt.ts        Astra's instructions (appended to the Claude Code system prompt)
  permissions.ts   What runs without asking
  safeSites.ts     The safe-site list: hosts she may fetch pages from without asking
  security/
    urlCheck.ts    Checks an address before a fetch: warning signs, Quad9, Google Safe Browsing, URLhaus
    contentScan.ts Cleans a fetched page before she reads it: hidden text, instructions aimed at an AI
  activity.ts      Tool calls → what she says she's doing, its glyph, uploads/downloads
  settings.ts      Remembered preferences (~/.jarvis/settings.json): volume, type-only, god mode
  config.ts        Environment variables → config
  tools/
    server.ts      In-process MCP server exposing Astra's own tools
    brain.ts       Markdown second brain: save, search, list, read by section
    mac.ts         open apps/files, clean Chrome for REA
    sessions.ts    Reads your Claude Code sessions from ~/.claude/projects; app deep links
    runner.ts      Runs sessions in the background (new, or resumed with a prompt)
    sitrep.ts      The sit rep: what every session is doing, spoken and on screen
    serve.ts       Serves a built app locally to open it
    git.ts         Read-only git queries for the git changes panel
  ui/
    orb.ts         talks to the orb window over JSON lines
    control.ts     Her interface actions, and commands recognised without asking Claude
    worklog.ts     Shell commands and file edits, for the terminal and git panels
    detail.ts      Markdown → safe HTML for the detail panel
    graph.ts       Teardown map (3D graph) validation
    dialog.ts      macOS approval pop-up (fallback when the orb isn't running)
  voice/
    listener.ts    sox recording + whisper.cpp transcription
    wake.ts        The "Astra" wake word, and cutting her own voice out of what the mic heard
    answers.ts     Answering approvals and questions by voice
    transcript.ts  Long transcript mode: start/stop phrases, formatting
    speaker.ts     speaks sentence by sentence, renders ahead, reports loudness for the orb
    tts.ts         Kokoro (default) and `say` engines
    audio.ts       WAV encode/decode, loudness envelope
    speechText.ts  Markdown → speakable text
orb/               Electron app for the orb and its panels (plain HTML/CSS/JS; the 3D map is bundled by esbuild)
```
