import { describe, expect, it } from "vitest";
import { dropRepeats, headline, MoreQueue } from "../src/voice/brevity.js";
import { localCommand } from "../src/ui/control.js";

describe("headline", () => {
  it("keeps a short reply whole", () => {
    expect(headline("Quench is open. Try the Start epic button.")).toEqual({ spoken: "Quench is open. Try the Start epic button.", rest: "" });
  });

  it("speaks whole sentences up to about 30 words and holds the rest", () => {
    const reply =
      "The Quench run finished with 117 tests passing. It added the gate inspector and the Start epic button. " +
      "The button only switches on when every pre-flight check passes, and it opens Claude Code with temper epic ready. " +
      "Nothing is pushed yet.";
    const { spoken, rest } = headline(reply);
    expect(spoken).toBe("The Quench run finished with 117 tests passing. It added the gate inspector and the Start epic button.");
    expect(rest).toMatch(/^The button only switches on.*Nothing is pushed yet\.$/);
  });

  it("always says the first sentence, however long, and reads lists as sentences", () => {
    const long = `${"word ".repeat(60).trim()}. Second.`;
    expect(headline(long).spoken.split(" ")).toHaveLength(60);
    expect(headline("Two changes:\n- **wrap** long lines\n- add a `Copy` button").spoken).toBe("Two changes: wrap long lines add a Copy button");
  });
});

describe("dropRepeats", () => {
  const now = 1_000_000;
  const said = [{ text: "The three voice-fix commits haven't been pushed yet. Restart me whenever you're ready.", at: now - 60_000 }];

  it("drops a sentence she said a minute ago, near enough word for word", () => {
    expect(dropRepeats("Quench is done. The three voice fix commits haven't been pushed yet.", said, now)).toBe("Quench is done.");
  });

  it("keeps it once ten minutes have passed, and keeps short sentences", () => {
    expect(dropRepeats("The three voice-fix commits haven't been pushed yet.", said, now + 20 * 60_000)).toBe("The three voice-fix commits haven't been pushed yet.");
    expect(dropRepeats("Done.", [{ text: "Done.", at: now }], now)).toBe("Done.");
  });

  it("keeps a sentence that only shares a few words", () => {
    expect(dropRepeats("The Temper commits have been pushed now, all four of them.", said, now)).toBe("The Temper commits have been pushed now, all four of them.");
  });
});

describe("tell me more", () => {
  it("reads the held rest in chunks, then nothing", () => {
    const more = new MoreQueue();
    more.setRest(`${"One two three four five six seven eight nine ten. ".repeat(6).trim()}`);
    expect(more.next()?.split(" ")).toHaveLength(30);
    expect(more.next()?.split(" ")).toHaveLength(30);
    expect(more.next()).toBeNull();
    expect(more.empty).toBe(true);
  });

  it("reads a panel's sections without its code", () => {
    const more = new MoreQueue();
    more.setPanel("## Summary\nA SilverStripe site.\n\n```sh\nnpm test\n```\n\n## Stack\nImperva in front.");
    expect(more.next()).toBe("Summary. A SilverStripe site. Stack. Imperva in front.");
  });

  it.each(["more", "Tell me more.", "Astra, tell me more please", "what else?"])("hears %j as /more", (s) => {
    expect(localCommand(s)).toEqual({ slash: "/more" });
  });

  it.each(["go on", "carry on", "more coffee", "tell me more about Temper"])("leaves %j to her", (s) => {
    expect(localCommand(s)).toBeNull();
  });
});
