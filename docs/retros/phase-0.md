# Phase 0 Retro — Scaffolding

## What I Built

The full project scaffold: backend (FastAPI + SQLModel + SQLite), frontend (React + Vite + TypeScript + Tailwind), configuration system, and tooling.

### Backend
- **FastAPI app** with lifecycle hooks, CORS, static file serving
- **Core modules**: `device.py` (MPS/CPU selection), `config.py` (YAML + env layered config), `logging.py` (structured logging), `metrics.py` (in-memory latency/source stats collector)
- **API routes**: `/api/health`, `/api/metrics`, `/api/config` (with API key redaction), plus stubs for sources/zones/incidents
- **Database**: SQLModel models for Source, Zone, Incident, RiskSample — tables created on startup
- **Model registry**: interface ready for Phase 2 (pretrained/finetuned switching via config)

### Frontend
- **Design system** (`index.css`): ~650 lines of tokens and components matching the Stoken reference — lavender sidebar, sage/cream/charcoal card system, pill buttons, status dots, bento grid, loading skeletons, empty states
- **Sidebar** with SVG icons, NavLink routing, and the distinctive oversized active-item pill from the reference
- **Five pages**: Overview (bento grid with stat card, risk gauge, sparklines, zone controls, action tiles), Live Ops (camera tile placeholders, alert feed), Zones, Incidents, System (actually fetches from `/api/health` and `/api/metrics`)
- **SVG logo**: prism with three spectrum lines (vision/motion/audio)
- **Always-visible disclaimer footer**

### Tooling & Config
- Makefile with all targets (dev, test, bench, demo, lint, clean, https)
- YAML configs: `app.yaml`, `fusion.yaml`, `audio_groups.yaml`
- `pyproject.toml` with ruff + pytest configuration
- `.env.example`, `.gitignore`

### Documentation
- `README.md` — problem, why hard, architecture, decisions, limitations, ethics
- `docs/ARCHITECTURE.md` — full system diagram and tech stack
- `docs/DECISIONS.md` — every Phase 0 decision logged with rationale
- `docs/ROADMAP.md` — future work tracked here, not as TODOs
- `training/README.md` — Phase 7 stubs

## How I Verified It

1. **12 backend tests pass** — health endpoint, device selection, config loading, fusion weight invariants, hysteresis ordering, API key redaction
2. **Backend server starts cleanly** — proper startup banner, DB initialization, health endpoint responds with correct device info and RAM/CPU stats
3. **Frontend builds without errors** — Vite production build succeeds (447ms, 16KB CSS, 279KB JS)
4. **API proxy works** — Vite dev server forwards `/api/*` requests to the backend correctly
5. **System page is live** — actually fetches from `/api/health` and `/api/metrics` and displays real device info

## What I Noticed Along the Way

1. **CSS `@import` ordering with Tailwind v4**: The `@import url(...)` for Google Fonts must come *before* `@import "tailwindcss"` because Tailwind v4 expands into `@layer` directives. CSS spec requires `@import` statements to precede all other statements. Fixed immediately.

2. **Python 3.14 on this machine**: The spec says 3.11+, we have 3.14. `uv` created the venv with 3.12.14 (probably a managed version). Everything works.

3. **No PyTorch in the venv yet**: The Phase 0 backend doesn't need torch for the scaffold tests. I installed only the lightweight deps (fastapi, sqlmodel, etc.). Torch + YOLO + transformers will come in Phase 2 when we actually need inference. This keeps Phase 0 fast to set up.

4. **Playwright browser screenshots unavailable**: The Playwright driver download returned 404 (infrastructure issue). I verified the UI via curl + build instead. Actual visual comparison against the reference will happen when screenshots are possible.

## What I Added Beyond the Spec

- **Config redaction on the `/api/config` endpoint** (Tier 1: just did it). An interviewer hitting the config endpoint shouldn't see API keys.
- **Fusion weight sum invariant test** — catches config drift early.
- **Hysteresis ordering test** — a misconfigured threshold (up < down) would cause flapping. The test catches that.

## What I'm Not Happy With

- **No Playwright screenshots yet** — can't do the side-by-side visual comparison the spec calls for. The build is clean and the CSS matches the reference design language, but I haven't verified pixel-level rendering.
- **Light/dark toggle is wired but doesn't actually change theme yet** — needs CSS custom property switching. Will address in a later phase.
- **The Overview page bento grid uses inline styles for layout** — should be moved to Tailwind utilities or CSS classes for consistency. Works fine, just not as clean as I'd like.

## Proposals (Tier 3)

None for Phase 0. The scaffold follows the spec exactly.

## What I'd Test or Build Next

**Phase 1: Ingestion + Live Feeds**
1. Source registry with CRUD endpoints and token generation
2. File loop adapter (most important for repeatable development)
3. Local webcam adapter
4. Simulated source adapter (scripted calm→panic scenarios)
5. Browser node page with `/ws/node` WebSocket endpoint
6. Dashboard camera tiles with live MJPEG preview
7. Source health monitoring (FPS, drops, last-seen, reconnects)
8. HTTPS helper script and `docs/REMOTE_NODES.md`

I'll start with the file loop adapter because it unblocks everything else — once I can feed a video file into the pipeline, I can develop and test all downstream features without needing a camera.
