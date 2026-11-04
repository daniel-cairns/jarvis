# Astra: abilities and manual test script

Written 2026-11-04, against `main` at fe7f5f7. This list comes from her tool list ([server.ts](../src/tools/server.ts)),
her spoken commands ([control.ts](../src/ui/control.ts)) and her help text ([index.ts:55](../src/index.ts#L55)).

## What she can do

### Talking and listening
- **Wake word:** say "Astra" to wake her. She chimes, then listens. `/wake on|off` turns the wake word on or off.
- **Follow-up:** after a spoken exchange she keeps listening for your reply, so you don't need to say "Astra" again.
- **Stopping her:** say "stop", "cancel", "never mind" or "be quiet". Esc on the orb or Ctrl-C does the same.
- **Not hearing herself:** words she said in the last 20 seconds are filtered out of what she hears.
- **Voiceprint:** "learn my voice" (or `/voiceprint`) has you read five sentences. After that she ignores other voices. "Forget my voice" (or `/voiceprint off`) undoes it.
- **Headline then "more":** a spoken reply is cut to about 30 words. Say "more" or "tell me more" to hear the rest, or the panel she just opened, in chunks.
- **No repeats:** a sentence she said in the last 10 minutes isn't said again (short ones like "Done." can be).
- **Modes:**
  - `/type`: mic off and silent, replies on screen only.
  - `/voice`: back to talking.
  - `/mute` and `/unmute`: her voice only.
  - Volume: "louder", "quieter", or "volume 40".
- **Transcript:** "start a transcript called X", or `/transcript X`, records everything until you say "stop recording". It's saved to the brain under transcripts.

### Being your EA
- **On your plate:** "what's on my plate?" shows your open loops (decisions waiting on you, runs in flight, things for later), with a one-line summary.
- **Remembering what you settled:** answering a run's card closes that question, and she's told it's settled.
- **"Remind me later":** she adds a "later" loop with `loops_add` and closes it when it's done. Loops are kept in `~/.jarvis/loops.json` and survive a restart.
- **Background updates:** when a run finishes she tells you in one sentence, in her own words, what it means for you. If it doesn't matter, she says nothing.
- **Asking you things:** cards with 2 to 5 option buttons. Answer by voice or by clicking.

### Running your Claude Code sessions
- **List and read:** `sessions_list` and `session_read` cover the desktop app and the terminal.
- **Send and start:** `session_send` sends to an idle session. `session_start` starts one in the background, or in the app so you can watch.
- **Open and stop:** `session_open` and `session_stop`. Approvals from her background runs come to you through her.
- **Sit rep:** "sit rep" or `/sitrep` gives a panel for every session plus a spoken summary.
- **God mode:** `/god on|off`. She hands project work to sessions rather than doing it herself, and announces when they finish. While it's on, a gold ring of carved glyphs turns round the orb, a satellite per commanded session orbits her (bright pulse working, dim idle, amber waiting on you; click one to open it), and the Eye sits on her left wing. A soft chime and a one-line toast mark it turning on or off.
- **The glyph slate:** hover or Tab to the orb (or click the Eye) in God mode and a small wing of glyph cartouches pops out on the side facing the middle of the screen: one per session, background run and open decision. Hover or focus a glyph for what it means, the session, a one-line summary, the time, its last action and what it needs from you; click to open the session. It folds after 6 s untouched, as you leave it, or on Escape.
- **Live sessions panel:** "show the sessions panel". You can open, read, message or stop sessions from it.

### Her screen and windows
- **Panels:** detail panels (markdown), 3D teardown maps, the terminal log, git changes, the brain browser and Tallyline.
- **Windows:**
  - "stack the windows" (`/stack`) tidies them;
  - "bring the panels to the front";
  - "show the windows again";
  - "close the panels".
- **Orb:** "minimise" folds her into the menu bar and "come back" brings her out. "Move to top left" or "nudge left" moves her. "Collapse" and "expand" fold her thinking window.

### Second brain
- `brain_save`, `brain_search`, `brain_list` and `brain_read`. Long reports can be read one section at a time.
- "open my brain" opens the brain browser.

### Using the Mac
- **Opening things:** `open_app`, `open_path` (for things she made), and `serve_app`, which serves a built web app on 127.0.0.1 and opens it.
- **Computer use:** `computer_read_ui`, `press`, `click`, `type`, `key`, `scroll`, `screenshot`, `windows` and `open_app`.
  - She asks before anything that sends, buys, deletes or submits.
  - She never types into password fields.
  - `computer_permissions` checks Accessibility and Screen Recording.
- **Coffee mode:** "coffee mode for two hours" keeps the Mac awake. It carries on through a restart.

### Thoth, the scribe
- While she researches for more than about 1.5 seconds, Thoth rises behind the orb. That covers web searches and page fetches, her brain, a teardown or report, and REA analysis that only reads.
- His pen writes and his moon brightens. When she finds it, he glints and sinks away.
- The status says "Researching…". Anubis takes priority over him.

### Teardowns (REA)
- `launch_clean_browser`, plus REA's own tools, for reverse-engineering an app or site.
- The results are saved to `teardowns/`, and she can show a 3D map with `show_graph`.

### Safety
- **Free without asking:** reading, memory, web searches, opening things, and writing inside the workspace.
- **She asks you first:**
  - page fetches from sites not on `~/.jarvis/safe-sites.json`;
  - shell commands;
  - REA's tools;
  - your connectors (Gmail, Calendar, Notion and so on).

  "Always" allows that one tool or host for the session only.
- **Web content:**
  - Every fetch has its URL checked and its content scanned.
  - A conversation that has read web content is flagged before it can start or send to a session.

### Housekeeping
- **Conversations:** `/new` starts a fresh one. `/continue` (or "pick up where we left off") resumes the last one.
- **Restart:** `/restart`, or "restart yourself". She waits for her reply and any background runs to finish.
- **Help and quit:** `/help` lists commands. `/quit` closes her.
- **Demo mode:** say "demo mode", "show off" or "give me a tour", or type `/demo`. She gives a narrated tour of about three minutes: every orb state, glyph, card and panel, using made-up data. It makes no Claude turns, so it costs $0. "Stop" or Esc ends it.

---

## Manual test script

Tick each line as you go. **Expect** is what a pass looks like.

**Before you start:**
- Have Astra running and idle.
- Open `~/.jarvis/logs/astra.log` in a terminal (`tail -f`).
- Do the tests in order, because some build on earlier ones.

### A. Voice basics
| # | Do | Expect |
|---|---|---|
| A1 | Say "Astra". | Chime; the orb goes to listening. |
| A2 | "What time is it?" | A short spoken answer. |
| A3 | Straight after, without "Astra": "And what day is it?" | She heard it as a follow-up and answers. |
| A4 | Ask something long ("explain how you decide what to ask me first"), and say "stop" mid-sentence. | She stops talking within a second or so. |
| A5 | Ask it again, then press Esc on the orb. | She stops. |
| A6 | "Louder", then "quieter", then "volume 50". | The volume changes each time, without a Claude turn (no "(done · $…)" line in the log). |
| A7 | "Mute". Ask anything, then "unmute". | Muted: the reply is on screen but not spoken. Unmuted: she speaks again. |
| A8 | `/wake off`, then say "Astra". | No chime. `/wake on` brings it back. |

### B. Headline and "more"
| # | Do | Expect |
|---|---|---|
| B1 | "Tell me everything you know about the Temper project." | One or two sentences, about 30 words, then she stops. |
| B2 | "More." | The next chunk. Repeat until she says there's nothing more. |
| B3 | Ask the same B1 question again within 10 minutes. | She doesn't say the same sentences word for word. |
| B4 | Ask for something that opens a panel ("show me my recent notes"), then say "more". | She reads the panel aloud in chunks, without "code omitted" noise. |

### C. Voiceprint (needs a second person, or a voice on YouTube)
| # | Do | Expect |
|---|---|---|
| C1 | "Learn my voice", then read the five sentences as they're shown. | The first run downloads about 400 MB of model (once only). She says it's done. `~/.jarvis/voiceprint.json` exists. |
| C2 | Ask her anything normally. | She answers. The log shows a score line with ok. |
| C3 | Have someone else say "Astra, what time is it?" | She ignores it. The log shows a score below the threshold. |
| C4 | Say a very short "Astra, stop" yourself. | Short phrases are judged more leniently. Note whether you get through. |
| C5 | "Forget my voice." | `voiceprint.json` is gone and she listens to everyone again. Then run C1 again to re-enrol. |

> If she refuses you more than once in 20 phrases, tell me the score lines, and I'll set `adjust` in `voiceprint.json` (e.g. -0.03).

### D. EA: loops and briefings
| # | Do | Expect |
|---|---|---|
| D1 | "What's on my plate?" | A panel grouped into waiting on you, running and for later, plus one spoken line. |
| D2 | "Remind me later to book the dentist." | She confirms. D1 again shows it under For later. |
| D3 | "I've booked the dentist." | She closes that loop; D1 no longer shows it. |
| D4 | Start a background run that will ask you something ("start a background session in jarvis that asks me which colour I prefer, red or blue, then stops"). | A card appears. D1 shows it under waiting on your answer. |
| D5 | Click an answer on that card. Then ask "anything waiting on me?" | She doesn't ask that question again; the loop is closed with your answer. |
| D6 | Wait for the run to finish while you say nothing. | One sentence, in her words, about what it means for you. Not the run's report read out. |
| D7 | `/restart`, then D1. | "For later" loops survive. Runs that the restart ended are closed. |

### E. Sessions and god mode
| # | Do | Expect |
|---|---|---|
| E1 | "Sit rep." | A panel of every session plus a short spoken summary. |
| E2 | "What's the latest in the gymclaw session?" | She reads that session's last reply (a summary, not verbatim). |
| E3 | "Show the sessions panel." | A live panel. Open, read, message and stop work from it. |
| E4 | `/god on`, then "get the jarvis session to run the tests". | She hands the work to a session, says who she gave it to, and announces when it finishes. `/god off` afterwards. |
| E5 | "Start a session in jarvis in the app to list the docs folder." | It opens in the Claude app and runs there. |
| E6 | `/god on` with a few sessions open. Hover the orb, then Tab from it into the slate; press Escape. | The ring turns, a satellite per session orbits, the Eye is on her left wing, and the chime and toast play. The slate pops out towards the middle of the screen; each glyph's help text shows on hover and focus; Escape folds it and focus goes back to the orb. Left alone, it folds after about 6 s. With reduced motion: no turning, orbiting or unfolding, only fades. |

### F. Panels, windows and orb
| # | Do | Expect |
|---|---|---|
| F1 | "Show your terminal" and "show git changes". | Both panels open. |
| F2 | "Stack the windows." | The panels tile without overlapping. |
| F3 | Click another app over them, then "bring the panels to the front". | The panels come forward. |
| F4 | "Close the panels", then "show the windows again". | They close, then they come back. |
| F5 | "Minimise", then "come back". | She folds into the menu bar, then unfolds. |
| F6 | "Move to top left", then "nudge right". | The orb moves each time. |
| F7 | During a session upload or download, watch the orb. | Anubis is always in front of the upload and download glyphs. |
| F8 | "Show Tallyline." | A compact ledger panel; it starts Tallyline if it isn't running. |
| F9 | Ask her to research something that takes a few seconds ("search the web for the latest Kokoro voices", or "read me the Signal teardown"). | After about 1.5 s Thoth, the ibis-headed scribe, rises behind the orb: his pen writes gold marks that drift up, and his moon brightens. The status says "Researching…". When she has it, one glint off the moon and he sinks away. A quick lookup shows nothing. If Anubis is needed meanwhile (a page check, a refused voice), Anubis takes the front. With reduced motion: a fade in and out only. Also in the demo, after Anubis. |
| F10 | Hover each glyph on her lower wings (stop, record, type-only, minimise, the sun, and the Eye in God mode), then Tab onto one and press Escape. | Each shows a small help tip saying what it does, with Esc on stop (and on the Eye while the slate is out); the tip stays inside the window. Escape on a focused button hides its tip without stopping her; a second Escape stops her. With reduced motion the tip only fades in. |

### G. Brain and transcripts
| # | Do | Expect |
|---|---|---|
| G1 | "Save a note called test note saying hello." | She confirms and gives the path in `~/.jarvis/brain/notes/`. |
| G2 | "Find my test note." | She finds it with `brain_search`. |
| G3 | "Open my brain." | The brain browser opens. |
| G4 | "Start a transcript called standup." Talk for 30 seconds, then say "stop recording". | A transcript note saved under transcripts, with timestamps. |

### H. Mac and safety
| # | Do | Expect |
|---|---|---|
| H1 | "Open Notes." | Notes opens, and she doesn't ask first. |
| H2 | "Check your computer permissions." | She reports Accessibility and Screen Recording. If one is missing she opens the right Settings pane. |
| H3 | "In Notes, make a new note that says test." | She uses `computer_*` tools to do it. |
| H4 | "Fetch the page at example.org." | If it isn't on the safe-site list, she asks first. |
| H5 | "Run `ls` in the workspace." | She asks before running the shell command. |
| H6 | "What's on my calendar tomorrow?" | She asks before using the Calendar connector, then answers. |
| H7 | "Coffee mode for 30 minutes", then "is coffee mode on?" | On, with the time left. Then "coffee mode off". |

### I. Housekeeping
| # | Do | Expect |
|---|---|---|
| I1 | `/type`, then type a question. | A reply on screen only; the mic is off. `/voice` to go back. |
| I2 | `/new`, then "what did we just talk about?" | She doesn't remember. |
| I3 | `/restart`, then "pick up where we left off". | She resumes the previous conversation. |
| I4 | `/help` | The help text, including `/voiceprint` and `/demo`. |
| I5 | Say "demo mode" and click Teal on the colour card. | A tour of about three minutes, covering every state, glyph and panel. Watch that Anubis stays in front on uploads and downloads. She says "Teal. Noted." At the end her panels close and your real mode and coffee state come back. The log shows no `(done · $…)` line. |
| I6 | Say "demo mode", then "stop" (or press Esc) halfway through. | She stops within one line, her panels close, and her modes are put back. |

**Not covered here:** REA teardowns (long and costly) and `serve_app`. Test those only when you have a real app to tear down or serve.
