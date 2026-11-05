# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-05

## Context

Decisions about storage, background processing, security and LLM integration shape the whole codebase. Without a written record, the reasoning behind them is lost and later changes risk reintroducing problems that were already considered.

## Decision

Significant decisions are recorded as Architecture Decision Records in `docs/adr/`, using the format described by Michael Nygard: context, decision and consequences. Records are numbered sequentially and never edited after acceptance, except to mark them as superseded.

## Consequences

- Reviewers and new contributors can understand why the system is built the way it is.
- Writing a record forces alternatives and trade-offs to be stated explicitly.
- Records must be kept in step with the code. A decision that changes requires a new record.
