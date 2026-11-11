import { describe, expect, it } from "vitest";
import { redirectRequest } from "../src/ui/control.js";

describe("redirectRequest: changing her mind mid-task", () => {
  it.each([
    ["Stop, check my email instead.", "check my email instead."],
    ["Stop that and show me the sit rep", "show me the sit rep"],
    ["No, the Temper one.", "the Temper one."],
    ["Never mind, what's on my plate?", "what's on my plate?"],
    ["Wait, do the Signal teardown first", "do the Signal teardown first"],
    ["Forget that, open my brain", "open my brain"],
    ["Check the Jira board instead", "Check the Jira board"],
  ])("%j redirects to %j", (said, request) => {
    expect(redirectRequest(said)).toBe(request);
  });

  it.each([
    "What time is it?",
    "Actually, what's the weather like?",
    "Stop",
    "No",
    "Nothing's urgent, keep going",
    "Stopwatch for ten minutes",
    "Instead",
  ])("%j waits its turn", (said) => {
    expect(redirectRequest(said)).toBeNull();
  });
});
