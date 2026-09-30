# Spectra — Design Decisions Log

> Every non-obvious decision, logged as it's made.

## Phase 0 — Scaffolding

| Decision | Rationale |
|----------|-----------|
| **MPS fallback via env var at import time** | Set `PYTORCH_ENABLE_MPS_FALLBACK=1` before any torch import. Some AST/YOLO ops don't have MPS kernels yet; silent CPU fallback is better than a crash during inference. |
| **SQLModel over raw SQLAlchemy** | Combines Pydantic validation with SQLAlchemy ORM. Since we already use Pydantic everywhere, this removes the model-duplication problem. |
| **YAML config, not .env for tunables** | Fusion weights, thresholds, and audio groups are structured data that doesn't fit flat env vars. YAML gives us hierarchical config with comments. Env vars override for deployment. |
| **In-memory metrics, not Prometheus** | We need sub-second granularity pushed via WebSocket. A ring buffer of raw samples gives us p50/p95 without external dependencies. |
| **Tabular numerals as CSS default for data** | Control-room operators scan columns of numbers. Tabular numerals prevent layout jitter as digits change. |
| **`prefers-reduced-motion` respected** | Accessibility. Micro-animations are nice for engagement but bad for motion-sensitive users. |
| **Footer disclaimer always visible** | "Decision-support prototype. Not a certified safety system." — this must never scroll out of view. Legal and ethical requirement. |
| **Font choices: Anton + Space Grotesk** | Anton for the bold uppercase display text (matches reference's condensed impact headings). Space Grotesk for body — geometric, clean, good tabular numeral support. |
| **npm over pnpm** | pnpm not installed on this machine; npm is the default. Low risk, can migrate later if needed. |
| **Ruff over flake8+black** | Single tool for linting + formatting. Faster, simpler config. |
