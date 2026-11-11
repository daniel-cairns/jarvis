import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABILITIES, abilitiesSection, helpText, uiActionsOf, uiControlDescription } from "../src/abilities.js";
import { isStopCommand, localCommand, UI_ACTIONS } from "../src/ui/control.js";

const slashes = (a: (typeof ABILITIES)[number]) => (a.slash ?? "").split(/,\s*/).filter(Boolean);

describe("her one list of abilities", () => {
  it("covers every ui_control action exactly once", () => {
    const listed = ABILITIES.flatMap(uiActionsOf);
    expect([...listed].sort()).toEqual([...UI_ACTIONS].sort());
  });

  it("covers every typed command her main loop handles", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const handled = new Set([...source.matchAll(/request === "(\/[a-z]+)(?: [a-z]+)?"/g)].map((m) => m[1]!));
    handled.delete("/brief"); // internal: a background update waking her, not something Dan types
    handled.delete("/exit"); // a synonym of /quit
    const listed = ABILITIES.flatMap(slashes).join(" ");
    for (const cmd of handled) expect(listed, cmd).toContain(cmd);
  });

  it.each(ABILITIES.flatMap((a) => (a.say ?? []).map((phrase) => [a.name, phrase] as const)))(
    "%s: \"%s\" is heard as that command",
    (name, phrase) => {
      const ability = ABILITIES.find((a) => a.name === name)!;
      if (uiActionsOf(ability).includes("stop")) return void expect(isStopCommand(phrase)).toBe(true);
      const got = localCommand(phrase);
      expect(got, phrase).not.toBeNull();
      if (got && "ui" in got) expect(uiActionsOf(ability)).toContain(got.ui.action);
      else expect(slashes(ability).map((s) => s.split(/[ [|]/)[0])).toContain(got!.slash.split(" ")[0]);
    },
  );

  it("puts every typed command in the help text, every action in ui_control, every ability in her instructions", () => {
    for (const a of ABILITIES) {
      for (const s of slashes(a)) expect(helpText()).toContain(s);
      for (const action of uiActionsOf(a)) expect(uiControlDescription()).toContain(action);
      expect(abilitiesSection()).toContain(`- ${a.name} (`);
    }
    expect(abilitiesSection()).toMatch(/- Demo \(ui_control demo; typed \/demo; Dan says "demo mode"\)/);
  });
});
