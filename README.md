# Jarvis

A local voice assistant for your Mac, built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk),
with [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) as its x-ray vision.

You talk, Jarvis works: it can tear down a website or a Mac app with REA, save the report to a markdown
"second brain", read it back to you section by section, build an original version of what it found,
test it, and open it.

Speech in and out runs on your machine (whisper.cpp + the built-in `say` voice). The only thing that
leaves your Mac is the conversation with Claude.

## What it can do

| Ask | What happens |
|-----|--------------|
| "Tear down igloo.inc" | Opens a clean Chrome profile, runs REA's browser tools, saves a teardown to `brain/teardowns/` |
| "Read me that teardown" | Reads the report aloud one section at a time, asking before each next section |
| "Reverse engineer the Notes app" | Runs REA's desktop/app analysis on `/System/Applications/Notes.app` |
| "Build me my own version" | Builds an original app under `workspace/` from the blueprint, tests it, opens it |
| "Open Safari" / "Open the app you built" | Opens apps, or files Jarvis made |
| "What did we learn about igloo?" | Searches the brain |

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

# 3. REA
npm install -g rea-agents

# 4. Jarvis
git clone <this repo> jarvis && cd jarvis
npm install
cp .env.example .env    # optional: change the voice, model, budget, folders
```

**Claude credentials:** log in once with Claude Code (`claude`, then `/login`), or set `ANTHROPIC_API_KEY` in `.env`.

**Microphone permission:** the first time you talk, macOS asks whether your terminal app may use the microphone. Say yes.

**For app teardowns:** REA's native analysis needs Hopper, Ghidra or IDA. `rea doctor` and the
[REA installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md) cover this.
Website teardowns only need Google Chrome.

## Run it

```bash
npm start            # voice: press Enter to talk, Enter again to send
npm run text         # typed mode
npm start -- --mute  # voice in, text out
```

In either mode you can also type a request. Commands: `/new` (fresh conversation, brain kept), `/mute`,
`/unmute`, `/help`, `/quit`. **Ctrl-C** cancels the request in progress; press it again when idle to quit.

## What Jarvis may do without asking

| Allowed automatically | Asks you first |
|-----------------------|----------------|
| Reading files, searching the web | Shell commands |
| Saving and reading brain notes | REA tools (answer "always" to stop being asked for that tool this session) |
| Writing files inside `workspace/` | Writing anywhere outside `workspace/` |
| Opening apps, and files inside its own folders | |

Each request also has a spending cap (`JARVIS_MAX_BUDGET_USD`, default $5).

## Responsible use

REA is for learning, interoperability and software you're allowed to analyse. Jarvis builds **original**
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
  index.ts         CLI: push-to-talk loop, typed mode, approvals
  agent.ts         Claude Agent SDK session: options, permissions, spoken output
  prompt.ts        Jarvis's instructions (appended to the Claude Code system prompt)
  permissions.ts   What runs without asking
  config.ts        Environment variables → config
  tools/
    server.ts      In-process MCP server exposing Jarvis's own tools
    brain.ts       Markdown second brain: save, search, list, read by section
    mac.ts         open apps/files, clean Chrome for REA
  voice/
    listener.ts    sox recording + whisper.cpp transcription
    speaker.ts     macOS `say`, chunked so it can be interrupted
    speechText.ts  Markdown → speakable text
```
