// What the compact Tallyline panel says, as plain data: no DOM, so the tests can check it.
(() => {
  const CATEGORY = { todo: "To do", in_progress: "In progress", done: "Done" };

  /** Seconds as "1 h 25 min", "40 min", or "none yet". */
  function duration(seconds) {
    const mins = Math.round((Number(seconds) || 0) / 60);
    if (mins <= 0) return "none yet";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  }

  /** The panel's content from Astra's message: a state (loading, starting, error, ready) and the lines to show. */
  function view(msg) {
    if (msg?.error) return { state: "error", meta: "NOT RUNNING", error: String(msg.error) };
    if (msg?.starting) return { state: "starting", meta: "STARTING" };
    const s = msg?.summary;
    if (!s) return { state: "loading", meta: "LOADING" };
    const sprint = s.sprint
      ? {
          name: s.sprint.name,
          board: `/boards/${encodeURIComponent(s.sprint.projectKey)}`,
          total: s.sprint.total,
          counts: [
            { label: "To do", n: s.sprint.byStatus.todo },
            { label: "In progress", n: s.sprint.byStatus.inProgress },
            { label: "Done", n: s.sprint.byStatus.done },
          ],
          text: `${s.sprint.total} ${s.sprint.total === 1 ? "issue" : "issues"}: ${s.sprint.byStatus.todo} to do, ${s.sprint.byStatus.inProgress} in progress, ${s.sprint.byStatus.done} done`,
        }
      : null;
    return {
      state: "ready",
      meta: sprint ? sprint.name.toUpperCase() : "NO ACTIVE SPRINT",
      sprint,
      today: duration(s.todaySeconds),
      recent: (s.recent ?? []).slice(0, 5).map((r) => ({
        key: r.key,
        summary: r.summary,
        status: r.status ?? CATEGORY[r.category] ?? "No status",
        path: `/issues/${encodeURIComponent(r.key)}`,
      })),
    };
  }

  const api = { view, duration };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.tallylineView = api;
})();
