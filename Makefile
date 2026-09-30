# ──────────────────────────────────────────────────────────────────────
# Spectra — Project Makefile
# ──────────────────────────────────────────────────────────────────────
# Usage:
#   make setup    — Install all dependencies (backend + frontend)
#   make dev      — Start backend + frontend dev servers
#   make test     — Run all tests
#   make bench    — Run benchmarks
#   make demo     — Launch demo with simulated sources
#   make lint     — Lint backend code
#   make clean    — Remove build artifacts and cached data

.PHONY: setup setup-backend setup-frontend dev dev-backend dev-frontend test lint bench demo clean https

# ── Setup ──────────────────────────────────────────────────────────────

setup: setup-backend setup-frontend
	@echo "✓ Spectra setup complete"

setup-backend:
	@echo "→ Installing Python dependencies…"
	cd backend && uv pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt
	@echo "✓ Backend ready"

setup-frontend:
	@echo "→ Installing frontend dependencies…"
	cd frontend && npm install
	@echo "✓ Frontend ready"

# ── Development ────────────────────────────────────────────────────────

dev:
	@echo "Starting Spectra dev servers…"
	$(MAKE) dev-backend &
	$(MAKE) dev-frontend &
	wait

dev-backend:
	cd backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

# ── Testing ────────────────────────────────────────────────────────────

test:
	cd backend && python -m pytest tests/ -v --tb=short

lint:
	cd backend && python -m ruff check . --fix
	cd backend && python -m ruff format .

# ── Benchmarks & Evaluation ───────────────────────────────────────────

bench:
	cd backend && python -m scripts.bench

# ── Demo ───────────────────────────────────────────────────────────────

demo:
	@echo "═══════════════════════════════════════════════"
	@echo "  SPECTRA — Demo Mode"
	@echo "  Simulated sources will be clearly labeled SIM"
	@echo "═══════════════════════════════════════════════"
	SPECTRA_SIM_MODE=true $(MAKE) dev

# ── HTTPS for remote nodes ─────────────────────────────────────────────

https:
	@echo "See docs/REMOTE_NODES.md for HTTPS setup options"
	@bash scripts/make_https.sh 2>/dev/null || echo "Run: mkcert -install && mkcert localhost 127.0.0.1 ::1"

# ── Cleanup ────────────────────────────────────────────────────────────

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .ruff_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/dist frontend/node_modules/.vite
	@echo "✓ Cleaned"
