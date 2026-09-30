"""
Structured logging for Spectra.

All modules use `logging.getLogger("spectra.<module>")`.
JSON formatting is available for production; human-readable for dev.
"""

import logging
import sys
from typing import Optional


def setup_logging(level: str = "INFO", json_format: bool = False) -> None:
    """Configure the root spectra logger.

    Called once at startup. Subsequent calls are no-ops (idempotent).
    """
    root_logger = logging.getLogger("spectra")

    if root_logger.handlers:
        return  # Already configured

    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)

    if json_format:
        # Minimal JSON lines for structured log aggregation
        import json as _json

        class JsonFormatter(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                return _json.dumps({
                    "ts": self.formatTime(record),
                    "level": record.levelname,
                    "logger": record.name,
                    "msg": record.getMessage(),
                    **({"exc": self.formatException(record.exc_info)} if record.exc_info else {}),
                })

        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s │ %(levelname)-7s │ %(name)-24s │ %(message)s",
            datefmt="%H:%M:%S",
        ))

    root_logger.addHandler(handler)

    # Quiet noisy third-party loggers
    for noisy in ("ultralytics", "PIL", "urllib3", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
