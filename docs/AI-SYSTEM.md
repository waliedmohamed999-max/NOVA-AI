# AI system

## Provider layer (`src/server/ai`)

- `types.ts` defines the `LLMProvider` interface: `generateText`, `generateStructured` (zod schema), `stream`, `analyze`, `summarize`, `classify`, and optional `embed`.
- `providers/anthropic.ts` uses the official `@anthropic-ai/sdk`:
  - adaptive thinking and `output_config.effort` on Claude Opus 5 / Sonnet 5;
  - structured output via `betaZodOutputFormat` + `beta.messages.parse`;
  - server-side refusal fallbacks (`fallbacks: "default"`) on Opus 5;
  - `refusal` and `max_tokens` stop reasons are handled.
- `providers/openai.ts` uses the official `openai` SDK Responses API. Structured output uses `zodTextFormat`; embeddings use `text-embedding-3-small` (1536 dims).
- `providers/offline.ts` is a deterministic provider for development and tests only. It is enabled by `AI_OFFLINE_MODE=true` and refused in production. Callers pass `offline()` builders that assemble output from the company's own stored data, and results are labelled "Offline AI" in the UI.

## Router (`router.ts`)

Candidates are ranked by:
- the task's required quality (`TASK_QUALITY`: strategy/copy/sales → best; analysis/structured/vision → balanced; summarise/classify/extract → fast);
- the preferred provider (`AI_PRIMARY_PROVIDER`);
- context size and vision support;
- cost (cheaper wins ties);
- availability — an in-process circuit breaker demotes a provider after 3 failures within 60 seconds.

When the organization is past its soft budget, quality drops one tier (the cost tier). Up to three candidates are tried, which gives fallback across models and providers. Refusals are not retried elsewhere.

Default model catalogue (`models.ts`):

| Tier | Anthropic | OpenAI (env-configurable) |
| --- | --- | --- |
| best | `claude-opus-5` | `OPENAI_MODEL_BEST` |
| balanced | `claude-sonnet-5` | — |
| fast | `claude-haiku-4-5` | `OPENAI_MODEL_FAST` |

## Logging and cost control

- Every attempt writes an `ai_runs` row: organization, workspace, agent, run, task type, provider, model, input/output tokens, cost (micro-USD), latency, status (SUCCESS/ERROR/BLOCKED) and whether a fallback was used.
- `ai_usage` holds monthly roll-ups per organization and agent.
- `ai_budgets` holds the monthly allowance, soft-limit % and hard-limit toggle. The soft limit sends one notification per month and switches the router to cost-saving. The hard limit blocks calls with `ai_budget_exceeded`.
- Customers see simple usage in Settings → Billing, with a per-agent breakdown under "Advanced". Platform admins see provider/model cost and latency in `/admin/ai`.

## RAG (`src/server/knowledge`)

- Ingestion (`knowledge.ingest` job): an SSRF-safe crawl of the website (home page plus up to 5 business pages) or raw text/documents is split into paragraph-aware chunks. Each chunk is stored with metadata, and gets an embedding when OpenAI is configured.
- Retrieval (`retrieveKnowledge`) merges pgvector cosine search with Postgres full-text rank, plus a looser any-term fallback. Every SQL statement filters by `organizationId` and `workspaceId`. Only the top-k chunks go into a prompt, never the whole database.
- `formatContext()` numbers passages so answers can cite them.

## Agents and grounding rules

System prompts tell models to use only the provided company information, performance facts and retrieved knowledge. They must not invent statistics, prices, testimonials or promises. Metrics are never computed by the model: `analytics/compare.ts` computes comparisons deterministically (baseline = previous N posts, same platform when there are at least 3), and the AI only explains them. Insights store their evidence JSON, and superseded insights are archived rather than overwritten.

Sales guardrails:
- Sensitive topics (discount, custom pricing, contract promise, refund, legal commitment, unusual delivery) are detected in the structured output.
- `messageDisposition()` combines autonomy (Assist/Copilot/Autopilot), the approval policies and the detected topics to decide: draft, approval, or send. It only sends through a configured channel and never pretends to.

## Command bar

`command` workflow: the request is classified into an intent (structured output), then routed to `content_plan`, `campaign`, `performance_review`, `leads_followup`, a pipeline summary, opportunities, or a RAG answer. Image attachments go to vision-capable models; text attachments become knowledge sources. The UI polls the run's high-level steps, then renders the result card with action buttons (review, approve all, approve plan…).

## Design agent

Design briefs are structured output on every planned post. `src/server/design/image-provider.ts` turns a brief plus the Brand Kit into a constrained image prompt (`buildImagePrompt`). The OpenAI image adapter is used when `OPENAI_API_KEY` is set. Without it, the "Generate visual" button is disabled and explains why.
