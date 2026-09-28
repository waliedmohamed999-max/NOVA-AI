import { registerJob, scopeOf } from "../jobs/registry";
import { executeRun } from "./runtime";
// Workflows register themselves with the runtime on import.
import "./workflows/onboarding";
import "./workflows/content";
import "./workflows/sales";
import "./workflows/analyst";
import "./workflows/command";
import "./workflows/carousel";

export function registerAgentJobs() {
  registerJob("agent.run", async (p) => executeRun(scopeOf(p), String(p.runId)));
}
