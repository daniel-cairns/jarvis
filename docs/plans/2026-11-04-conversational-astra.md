# Making Astra conversational: a plan (4 Nov 2026)

Goal: Astra behaves like a good executive assistant. She leads with what matters, says it once, keeps detail until
Dan asks for it, and never brings up something he has already settled. She should not sound like relayed Claude Code
output.

## What her last six conversations show (measured 4 Nov)

- **She reads card questions aloud after they've been answered.** `askQuestion` and `askApproval` speak the question
  and its options (src/index.ts, around lines 990 and 1121). Clicking the card ends the dialog but never stops that
  speech or anything queued behind it. Since 655fa27, words are queued as they arrive, so the queue can be long.
- **"No response requested." is spoken as a reply.** It appears 44 times across her conversations, usually after a
  card answer or a stray remark ("It's been finally gone to gaming."). The model is telling the harness it has nothing
  to say, and that text goes straight to the speaker (src/agent.ts:214).
- **Background-run reports are raw Claude Code output.** `finished` speaks the first sentence of the run's last message
  (src/index.ts, around line 1177). The report never passes through Astra, so it isn't in her conversation either.
  She can't tie it to anything, and she may raise it again later.
- **Card answers from background runs don't reach her conversation.** Dan answers a run's question on a card, but
  Astra's own conversation never hears what he chose. She can then ask him again.
- **Replies are still long, and she repeats status.** Her spoken texts have a median of 23 words, and the longest 10%
  run past 76 words, with bullet lists read aloud. She keeps repeating points such as "the commits haven't been pushed
  yet" and "restart me when you're ready". She also ends most replies with an offer like "Say if you want…" or "I can
  send it for you…".

## The plan

### Phase 1: stop stale and meta speech (code, tested) — built 4 Nov
1. **Answering a card silences that card.** Tag the utterances a dialog queues. When the dialog ends, drop them from
   the speech queue and cut one that's playing. Test: answer mid-question, and the rest isn't spoken.
2. **Filter meta replies.** Drop "No response requested." and similar text before it's spoken or shown, in one place
   next to `io.say`. Test the filter.
3. **Card answers enter her conversation.** Queue a note for her next turn, such as "(Dan answered the Quench run's
   question 'Add Start epic?': Yes, after Q2.)". She then knows what was decided, whoever asked.
4. **Run finishes go through her.** Instead of speaking the run's text, queue the finish as a note for her next turn.
   If she's idle, give her a short turn to deliver it in her own words: what it means for Dan and whether he has to do
   anything. When several finish close together, they arrive as one note.

### Phase 2: brief first, more on request
5. **Rewrite "How you speak" as an EA brief** in src/prompt.ts:
   - Lead with the outcome or the decision. Usually one sentence, and never more than 25 words aloud.
   - Never repeat something already said this conversation, unless it changed or he asks.
   - Make at most one offer, and only when there's an obvious next step. Put real choices on a card, not in a closing
     question.
   - If nothing needs saying, say nothing.
   - Never relay a session's words; translate them into what they mean for Dan.
6. **"Tell me more" is built in.** When a reply has detail behind it, she puts the detail on screen (show_detail)
   silently and speaks only the headline. A quick command ("more", "go on", "tell me more") reads the next section of
   the detail on screen, and it's cheap because it doesn't need a model turn.
7. **A spoken-length guard in code.** If speech goes over about 40 words, she says the first two sentences and the rest
   appears as a caption marked "more on screen". This backs up the prompt, because prompt rules alone haven't held
   (31ca8c3 already asked for brevity).
8. **Repeat guard.** Before speaking a sentence, compare it with her last 20 utterances (already kept in `spoken`). A
   near-duplicate from the last 10 minutes is shown as a caption, not spoken.

### Phase 3: an EA who keeps track
9. **Open loops.** Keep a small store (~/.jarvis/loops.json) of what's pending: decisions put to Dan, runs in flight,
   and "later" items he named. Cards and runs open and close loops automatically, so an answered question is closed
   and can't come back. She reads the store before any status update. An "On your plate" panel lists it, and "what's
   waiting on me?" answers from it.
10. **Morning or catch-up brief** (optional; uses existing connectors, and each use still asks first). On request she
    gives a short brief covering today's calendar, flagged email, the Tallyline sprint, and sessions waiting on Dan.
    It's one spoken headline per area, with the rest on screen.

### Verification
- Unit tests for items 1 to 4, 7, 8 and 9. Keep `npm test` and the typecheck green before each commit.
- A live check with Dan after restart: a 10-minute scripted session with a card, a background run and a "tell me
  more".
  - Targets: no spoken "No response requested" (44 now); no re-asked questions; median under 15 words; the longest
    10% under 35 words (76 now).
  - Measure the same way as above, from her conversation files.

## Notes
- src/prompt.ts has uncommitted edits from another session (the copy-button rule). Phase 2 needs those committed
  first.
- The phases are independent enough to commit separately. Phase 1 fixes the bugs Dan hears most.
