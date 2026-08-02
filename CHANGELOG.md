# Changelog

All notable changes to EzAgent are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-02

### Added

- Provider-neutral runtime with OpenAI and Gemini adapters
- Immutable `Agent`, bounded `Runner`, typed events, Zod tools, and tool deadlines
- Sessions, in-memory/file storage, and factual memory retrieval
- Guardrails, structured output repair, and async-iterator streaming
- Handoffs with loop prevention and maximum handoff limits
- Retry policy for retryable non-streaming provider failures
- Immutable traces, in-memory trace exporter, lifecycle middleware, and Agent plugins
- Integration/failure tests, reusable `tests/mocks/MockProvider`, examples, documentation, playground, CI, and package checks

### Changed

- `Runner.run()` results now include final-agent identity, handoff count, retry-aware tracing, and immutable `RunTrace` data.
- `Runner.stream()` now preserves handoffs, retries, middleware, traces, sessions, memory, guardrails, tools, and structured output.
- The playground now loads `.env`, explains setup, and falls back to local demo mode when provider keys are absent.
- Build output includes ESM, CommonJS, declarations, documented subpath exports, examples, docs, assets, and this changelog.

### Fixed

- Secret redaction now covers Gemini API key patterns (AQ. prefix)
- npm package no longer ships docs/, examples/, and assets/ to reduce download size

### Known limitations

- First-party provider retry replay is intentionally limited to non-streaming calls; replaying a visible stream can duplicate token output.
- `FileStorage` is a local Node.js adapter, not a transactional multi-process database.
- `InMemoryMemory` uses lexical retrieval; vector/semantic adapters are extension work.
- Handoff loop protection uses agent names, so distinct agents with the same name cannot appear in one handoff path.
- The playground is a local debugging CLI, not a hosted UI or production service.
