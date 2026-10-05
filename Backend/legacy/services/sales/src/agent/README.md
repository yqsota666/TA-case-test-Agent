# Case Agent backend — LangGraph

Node24, MySQL8.4 business data, PostgreSQL17 graph checkpoints. Locked runtime:
`@langchain/langgraph@1.4.18`, `@langchain/core@1.2.13`, official
`@langchain/langgraph-checkpoint-postgres@1.0.5`. AI SDK remains the Sophnet model
adapter (`ai@7.0.122`, OpenAI-compatible3.0.59), not the workflow runtime.

## Enable

Run `npm ci`. Select the existing platform DB with `PLATFORM_ENV_FILE`, verify it,
and apply additive migrations007/008/009 with the existing platform migration runner.
001–007 retain their checksums. Production Agent is off unless `AGENT_ENABLED=1`.

Create `.env.agent.local` (Git/Docker ignored, permissions600):

```dotenv
SOPHNET_API_KEY=<server-side-key>
SOPHNET_BASE_URL=https://api.sophnet.com/v1
SOPHNET_MODEL=DeepSeek-V4-Pro
AGENT_MODEL_TIMEOUT_MS=90000
AGENT_CHECKPOINT_URL=postgresql://case_agent:<password>@127.0.0.1:5433/case_agent
```

`AGENT_ENV_FILE` selects another file; environment variables override settings.
For local PostgreSQL, supply `AGENT_CHECKPOINT_PASSWORD` and run
`docker compose -f docker-compose.agent.yml up -d`. This uses a persistent volume;
back up it together with MySQL. The official saver initializes its own schema.
Checkpoint credentials need access to its dedicated database, including setup DDL.
Connection timeout5s, query timeout15s, startup retry3 with backoff. Failure keeps
an ERROR event and never silently falls back to memory. Tests may explicitly use
MemorySaver; normal integration tests and live evaluation use PostgresSaver.

Start `AGENT_ENABLED=1 npm run dev:platform`. Multiple workers use fenced MySQL
leases; one run writes sequentially. Shutdown closes worker and checkpoint pool.
Model calls occur outside transactions: nonstreaming Chat Completions, thinking
disabled, 8192 output tokens, bounded16 main requests plus a waiting explanation.
No alternate model is substituted. Credentials are absent from transcripts.

## Graphs and plans

- Conversation StateGraph uses load/recover/model/tools/explain/complete nodes,
  keyed by trusted workspace/chat/run/event. Failed processing resumes its saved
  graph position with a fresh lease, including previously committed tool actions.
- Component StateGraph is keyed by trusted workspace/chat/run. The complete plan
  is data; registered component nodes are reused with different instances,
  dependencies, parameters, bindings and outcome conditions. Its configuration
  is separate from the per-event graph namespace.
- `save_plan` validates the whole schemaVersion2 plan before any data execution.
  New component plans use the discussion/proposal/confirmation gate described
  below; direct model `save_plan` calls are rejected. `execute_plan` authorizes
  and drains READY nodes.
  External RETURN/DELIVERY events automatically advance the started version;
  unstarted or edited versions require explicit start. Background events cannot
  change plan, notes or test expectations.
- A receive/delivery component stores WAITING_INPUT, allowing other READY branches
  to proceed. Only when no branch can advance does the graph interrupt. Uploads
  wake the existing graph; final02/04 evidence, not arrival alone, unlocks it.
- MySQL owns plan, component revision/attempt/output/wait and transition history.
  A committed business action is replayed after checkpoint failure. Checkpoint
  snapshots cannot overwrite latest MySQL business facts.

## Plan discussion and confirmation

The Agent first discusses objectives, operation order, expected outcomes and
external02/04/05 evidence with the tester. At least two distinct USER message
turns are required before `propose_plan` accepts a complete, validated plan.
This is a minimum guard, not a claim that two turns always suffice. The Agent
should keep discussing while requirements are unclear.

`propose_plan` stores an immutable scoped proposal, visible in `GET .../agent`
and `get_case_state` as `planning.proposal`, including all component definitions.
It makes no business data and does not change `planVersion`. The tester can
review it and request changes; a new proposal supersedes the previous one.
To finalize, the tester must send a **new chat message** containing only the
proposal's `confirmationText` (`确认计划 <proposal UUID>`). `finalize_plan`
verifies that exact persisted USER message, the proposal ID/version and absence
of intervening discussion, then revalidates and commits the plan. RETURN,
DELIVERY, RESUME or Agent generated text cannot confirm it. A later explicit
user execution request starts components; confirmation alone creates no data.
Edits to future components use the same proposal/confirmation process.

Component kinds: customer.define, account.define, fund.define, data.validate,
application.prepare, file.generate, file.deliver, return.receive, result.validate,
position.reconcile, case.evaluate, case.archive. Plans support200 component
instances,80 applications. Customer/account definitions are separate. File
components may batch same-type/same-date applications. Typed output bindings
include original application, actual TA serial and target trading account.
Conditions select components using actual confirmation outcomes; skipped branches
require explicit joins that accept skipped dependencies. No arbitrary expressions.
Choose a branch on its application; an active application's `result.validate`
cannot be conditionally skipped.
The plan compiler wires `case.evaluate` to every business component and
`case.archive` to that evaluation, with skipped-branch joins enabled. These
mechanical edges are present in the immutable proposal shown to the tester.

Started components, including waiting reception identities, cannot change. Future
edits save a new version and require explicit start. Legacy24-step plans and
CUSTOMERS/FUND/APPLICATION/VERIFY_POSITION tools remain compatible; executed
legacy plans cannot change to schemaVersion2 inside the same run.

## HTTP and external input

Existing session cookie, ownership authentication and origin checks apply.
Base: `/api/chats/:chatPublicId/runs/:runPublicId`.

| Method/path | Contract |
|---|---|
| GET base/agent | Runtime, planning discussion count/latest full proposal, confirmed plan, components/status/output/wait/error and bounded action/message/event history |
| POST base/agent/messages | `{requestId: UUID, content: string}` →202 `{eventId, duplicate}` |
| POST base/agent/resume | `{requestId: UUID}` →202; requeues failed processing |

Same UUID/content retries deduplicate; changed content returns409. Limit10
USER/RESUME events per run/minute (429). Invalid input400; authentication401;
foreign scope404; stale version/immutable component/unmet dependency409. Async
failures report sanitized ERROR codes. Old leases cannot write or append messages.
New user input stops older writes; failed old calls become SUPERSEDED instead of
being executed. Archived runs reject new user writes.

Only01/03 are generated. Actual02/04/05 are uploaded through existing
`POST /api/returns`, routed by real application/account identifiers even when
mixed across cases. No Agent tool generates or uploads TA returns. Wait objects
include component ID, file types, missing application IDs, received evidence and
upload URL; waiting Agent results also include actual package download URLs for
generated files. Existing download/delivery endpoints
remain: a download is not evidence of actual manual delivery.

05 is a snapshot/reconciliation input and never overwrites holdings. Freshness
includes later04 and same-day import ordering. Validation distinguishes expected
business failure from test failure. Archive rereads actual facts, blocks unresolved
reconciliation/partial applications and checks all required component outcomes,
including quarantined conflicting04 files received after a terminal result.
070 has no04: explicit delivery evidence completes the notification without
inventing CONFIRMED. Business008/026/036/058 successful local effects still need
manual handling, so preflight rejects automatic success closure for them.

## Verification

```sh
npm run db:agent-eval
npm run db:agent-checkpoint
npm run test:agent
npm run test:agent-migration
npm run eval:agent-components
PLATFORM_ENV_FILE=.agent-eval/mysql.env npm run test:platform
npm run test:platform-protocol
npm test
```

Disposable test databases are guarded at127.0.0.1:13317(MySQL) and15437(Postgres).
The migration test uses13318 and removes it. Live evaluation uses the paid
DeepSeek V4 Pro API, actual scoped DBs and synthetic TA inputs supplied exclusively
by the evaluation script. Each phase uses a fresh worker OS process. Credentials,
reports, full audits and downloads remain in ignored `.agent-eval/`.
For graph logic debugging without PostgreSQL, explicitly set
`AGENT_TEST_CHECKPOINT=memory`; that is not persistence/restart evidence.

Use `node scripts/agent-eval-db.mjs stop` / `node scripts/agent-checkpoint-db.mjs stop`
only after exporting needed audits. Evaluation databases use tmpfs and lose data
when recreated. Production checkpoint compose uses a persistent volume.

## Limits

Backend only: no frontend upload modal or actual TA connection. Existing protocol
catalog is broader than automatic effects. Negative exceptions remain unopened
account purchase and zero-position redemption. No automatic resolution of05
differences, failed-case archival, cancellation API, OTEL export or shared vector
memory. Memory notes and complete audit history are scoped to each run. Model
context projects recent3 events plus original/latest intent and paired tools;
1000 raw messages/100000 projected characters stop with CONTEXT_LIMIT. Existing
business pages remain bounded; archive refuses truncated evidence. This is one
synthetic end-to-end model validation, not production reliability statistics.

Rollback: stop workers, keep a backup of proposal and component history, run
009 down SQL and then008 down SQL, then run the prior backend revision. Existing business tables and legacy agent plans
are preserved; PostgreSQL checkpoints are separate and should be retained for audit.
