import { logger } from "./logger";
import { assertStartupConfig } from "./config/validate";

/** Node-only startup gate: production exits when the configuration is invalid (see config/validate.ts). */
export function enforceStartupConfig(proc: "web" | "worker") {
  try {
    assertStartupConfig(logger);
  } catch (err) {
    logger.fatal({ err: { message: err instanceof Error ? err.message : String(err) }, process: proc }, "startup aborted: invalid production configuration");
    process.exit(1);
  }
}
