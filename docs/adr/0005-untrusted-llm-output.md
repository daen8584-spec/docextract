# 0005. Treat LLM output as untrusted input

- Status: Accepted
- Date: 2026-11-05

## Context

Language models produce plausible output that is sometimes wrong: invalid JSON, wrong types, invented values or fields copied from the wrong part of a document. Storing that output directly would corrupt data silently. Model quality also changes whenever the prompt, model or provider changes, so correctness needs to be measured rather than assumed.

## Decision

- **Schema validation.** Every response is parsed and validated with Zod (`lib/extract.ts`). Malformed JSON, wrong types, invalid ISO 8601 dates and currency values that are not three-letter codes are rejected with a descriptive error and the attempt is retried by the job queue.
- **Human review.** Extracted fields are a draft. Nothing is final until a reviewer approves it, optionally with corrections. Approved and rejected documents are immutable.
- **Recorded corrections.** Each approval stores a field-level diff between the model output and the approved values in the audit log. These corrections show where the model is weak.
- **Measured quality.** An evaluation harness (`npm run eval`) runs a fixed dataset through the extraction pipeline and reports per-field accuracy, separating incorrect, missing and hallucinated values. Reviewed documents can be exported into the dataset (`npm run eval:export`), so production corrections become regression cases.
- **Provider independence.** The client targets the OpenAI-compatible chat completions API with JSON mode and is configured through environment variables. Models can be compared with the evaluation harness before switching.

## Consequences

- Invalid model output never reaches the database.
- Prompt and model changes can be evaluated against a baseline before they are deployed.
- Review adds human effort. The correction rate and evaluation results indicate when the model is reliable enough to reduce it.
- JSON mode support varies between providers and models, which the evaluation harness makes visible.
