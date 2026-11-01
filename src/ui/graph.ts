/** The teardown map's data: what show_graph accepts and what the map window draws. */
import { z } from "zod";

export const NODE_GROUPS = ["app", "module", "framework", "feature", "data", "service", "other"] as const;

export const graphShape = {
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        label: z.string().min(1).max(80),
        group: z.enum(NODE_GROUPS),
        detail: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(400),
  edges: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        label: z.string().max(60).optional(),
        inferred: z.boolean().optional(),
      }),
    )
    .max(1200),
};

const graphSchema = z.object(graphShape);
export type TeardownGraph = z.infer<typeof graphSchema>;

/** Rejects duplicate node ids and edges that point at nodes that don't exist, naming them so the model can fix it. */
export function checkGraph(graph: TeardownGraph): TeardownGraph {
  const ids = new Set<string>();
  const dupes = new Set<string>();
  for (const n of graph.nodes) (ids.has(n.id) ? dupes : ids).add(n.id);
  const missing = new Set<string>();
  for (const e of graph.edges) for (const end of [e.source, e.target]) if (!ids.has(end)) missing.add(end);
  const problems = [
    dupes.size ? `duplicate node ids: ${[...dupes].slice(0, 10).join(", ")}` : "",
    missing.size ? `edges point at unknown node ids: ${[...missing].slice(0, 10).join(", ")}` : "",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Graph not shown: ${problems.join("; ")}`);
  return graph;
}

/** A plain-text version for when no orb is open (or for the terminal log). */
export function graphAsText(title: string, graph: TeardownGraph): string {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const lines = graph.edges.map(
    (e) => `  ${label.get(e.source)} ${e.label ?? "→"} ${label.get(e.target)}${e.inferred ? " (inferred)" : ""}`,
  );
  return `── ${title}: ${graph.nodes.length} nodes, ${graph.edges.length} links ──\n${lines.join("\n")}`;
}
