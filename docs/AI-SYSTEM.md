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
- availability — an in-process circuit breaker demotes a provider after 3 failures within 60 seconds. It is **process-local by design**. Each web and worker process keeps its own window, so with N instances an outage costs at most 3 extra failed calls per process per minute. It needs no Redis, and a restart simply starts it closed. Budgets, usage and rate limits are not affected: they live in PostgreSQL and are shared across instances.

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

## Content Studio (OpenAI text + images)

The studio is built on the existing layers rather than a separate AI stack. Text goes through the same router, budgets and `ai_runs`; images go through the `ImageProvider` boundary. Everything runs server-side, through the official OpenAI API.

| Piece | Where |
| --- | --- |
| Prompt registry (versioned: `content_strategy`, `caption_generation`, `content_improvement`, `visual_direction`, `image_generation`, `image_edit`, `performance_analysis`, `content_quality`) | `src/server/ai/prompts.ts`. The version is stored on `ai_runs.promptVersion`, `content_versions.promptVersion` and `content_assets.promptVersion` |
| Context: Company Brain, brand rules, campaign, real performance by pillar/format/platform (90 days, only with ≥3 posts), recent approved content, hooks to avoid | `src/server/studio/context.ts` |
| Improve / merge / edit / platform versions / quality check / week proposal | `src/server/studio/content.ts` |
| Images: queue, job, composition, storage, cost, limits | `src/server/studio/images.ts`, `src/server/design/{image-provider,compose}.ts` |

**No fake generation.**
- Studio calls pass `realOnly`, so they never use the offline development provider.
- Without `OPENAI_API_KEY`, customers see "OpenAI generation isn't set up yet" / "Image generation isn't set up yet".

**Text.** Structured outputs are validated with zod:
- `improve` returns hook, caption, CTA, hashtags, visual direction, 2–3 "why this is better" reasons, platform notes, and a video concept / on-screen text for Reels and TikTok.
- Nothing is overwritten. The Compare view offers "use", "merge" (per field), "edit" or "try again", and each choice becomes a new `content_versions` row with its source, reasons and quality check.
- Platform versions are separate posts (`derivedFromId`), written with each platform's guide.
- **Duplicate detection:** word-bigram Jaccard similarity (Arabic-normalised) against recent posts. If a hook is too similar, NOVA retries once with a different angle.
- **Quality check:** each of brand fit, clarity, CTA, platform fit, repetition and claim safety is marked `good` or `needs_attention` with a reason. There is no numeric score.

**Images.** The flow is `requestImage` → `ai.image.generate` job, and it never runs inside the HTTP request:
1. The asset moves through the statuses `QUEUED → GENERATING → UPLOADING → COMPLETED | FAILED`.
2. The creative direction is built from the post, the brand kit and recently approved visuals.
3. OpenAI generates the image (`images.generate`), or edits it (`images.edit`) with the current design as the reference.
4. The image is decoded on the server, resized and cropped (content-aware) from the closest supported size to the exact social size (1080×1080, 1080×1350, 1080×1920, 1200×627, 1200×630), then saved through the StorageProvider. The database stores only a `FileObject` reference; base64 is never stored.
5. **Brand Template** (the default) composes the headline, CTA, logo, brand colours and footer with `sharp` + SVG. This gives exact Arabic typography, because the image model never draws text.

Other image rules:
- **History:** variants (another, different style, simpler, more professional, no text) and edits are separate assets. Nothing is deleted, and one asset is `isSelected`. Publishing uses only the selected, completed asset.
- **Separation:** generating or editing an image never touches the caption, schedule or approval state, and improving the text never regenerates the image.
- **Retries and errors:** transient provider errors retry once. Refusals and other failures are final (`FAILED` with a safe `errorCode`), and customers see "We couldn't create the design. Your content is saved…".

**Models are configuration.**

| Variable | Used for |
| --- | --- |
| `OPENAI_TEXT_MODEL` | Content text (overrides `OPENAI_MODEL_BEST`) |
| `OPENAI_IMAGE_MODEL_FAST` | Drafts |
| `OPENAI_IMAGE_MODEL_QUALITY` | Highest quality and edits (both fall back to `OPENAI_IMAGE_MODEL`) |

Customers only see **Fast / Highest quality**. Model names appear only in `/admin/providers`, which also has **Test text** / **Test image** buttons. The test image is stored privately and never published.

**Cost and limits.**
- Each image logs an `ai_runs` row (`IMAGE_GENERATION` / `IMAGE_EDIT`, model, prompt version, estimated cost from `OPENAI_IMAGE_COST_*_USD`) and adds to the monthly AI budget (`ai_usage`).
- Plans cap monthly generations and edits (`imageGenerationsPerMonth`: Starter 30, Growth 150, Scale 600). The cap is checked before anything is queued.
- Settings → AI Team shows designs used / limit, edits, text runs and the estimated cost.

**Automated tests never call OpenAI.** They use fake text and image providers. Live checks are manual, through the admin test buttons.

**Fonts for Arabic templates:** the server needs an Arabic-capable system font, e.g. `fonts-noto-core` / Noto Sans Arabic or IBM Plex Sans Arabic on Linux. Windows and macOS already have one.
