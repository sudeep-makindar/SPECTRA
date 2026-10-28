"""
Telegram alerts — tell a group chat the moment an alert opens.

Per alert, the group gets:
  1. immediately:          "🚨 Act now at Gate" + the reason + a dashboard link
  2. when the AI summary and clip are ready: the clip snapshot, summary and to-do list
  3. when the zone is calm again: the full incident report as an HTML file
and a short message whenever an open alert gets worse.

Setup: TELEGRAM_BOT_TOKEN in .env (from @BotFather). The group is chosen in
the dashboard (Devices → Alerts on Telegram) and saved to data/telegram.json;
TELEGRAM_CHAT_ID in .env also works. Needs internet. Failures are logged and
shown in the dashboard; they never affect detection.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Optional

from app.core.config import DATA_DIR, INCIDENTS_DIR
from app.reports.plain import LEVEL_WORD, plain, plain_summary

logger = logging.getLogger("spectra.telegram")

SETTINGS_FILE = DATA_DIR / "telegram.json"
LEVEL_ICON = {"elevated": "⚠️", "high": "🟠", "critical": "🚨"}


def _e(s: object) -> str:
    return html.escape(str(s or ""), quote=False)


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "localhost"
    finally:
        s.close()


class TelegramError(RuntimeError):
    pass


class TelegramNotifier:
    _instance: Optional["TelegramNotifier"] = None

    def __init__(self) -> None:
        self.token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        self.api = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
        self.chat_ids: list[str] = self._load_chat_ids()
        self.bot_name: Optional[str] = None
        self.last_error: Optional[str] = None
        self.sent = 0

    @classmethod
    def instance(cls) -> "TelegramNotifier":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Settings ──────────────────────────────────────────────────────

    @staticmethod
    def _load_chat_ids() -> list[str]:
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")).get("chat_ids", [])
            if saved:
                return [str(c) for c in saved]
        except (OSError, ValueError):
            pass
        return [c.strip() for c in os.getenv("TELEGRAM_CHAT_ID", "").split(",") if c.strip()]

    def set_chat_ids(self, chat_ids: list[str]) -> None:
        self.chat_ids = [str(c).strip() for c in chat_ids if str(c).strip()]
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps({"chat_ids": self.chat_ids}, indent=2), encoding="utf-8")

    @property
    def configured(self) -> bool:
        return bool(self.token and self.chat_ids)

    def status(self) -> dict:
        return {"token_set": bool(self.token), "bot_name": self.bot_name, "chat_ids": self.chat_ids,
                "configured": self.configured, "last_error": self.last_error, "sent": self.sent}

    @staticmethod
    def dashboard_url(path: str = "") -> str:
        base = os.getenv("SPECTRA_DASHBOARD_URL", "").rstrip("/") or f"http://{_lan_ip()}:5173"
        return base + path

    # ── Telegram API (blocking; always called from a thread) ──────────

    def _call(self, method: str, fields: dict, file: Optional[tuple[str, str, bytes, str]] = None) -> dict:
        """file = (form field, filename, bytes, content type)."""
        if not self.token:
            raise TelegramError("No bot token. Set TELEGRAM_BOT_TOKEN in .env and restart SPECTRA.")
        url = f"{self.api}/bot{self.token}/{method}"
        if file:
            boundary = uuid.uuid4().hex
            body = b""
            for k, v in fields.items():
                body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
            name, filename, data, ctype = file
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                     f"Content-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
            req = urllib.request.Request(url, body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        else:
            req = urllib.request.Request(url, urllib.parse.urlencode(fields).encode())
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                out = json.load(r)
        except urllib.error.HTTPError as exc:
            try:
                detail = json.load(exc).get("description", str(exc))
            except ValueError:
                detail = str(exc)
            raise TelegramError(f"Telegram refused it: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise TelegramError(f"Can't reach Telegram ({exc}). Is this computer online, and is Telegram allowed on this network?") from exc
        if not out.get("ok"):
            raise TelegramError(f"Telegram refused it: {out.get('description', 'unknown error')}")
        return out.get("result", {})

    async def _send(self, method: str, fields: dict, file=None) -> int:
        """Send to every configured chat. Returns how many succeeded."""
        ok = 0
        for chat in self.chat_ids:
            try:
                await asyncio.to_thread(self._call, method, {"chat_id": chat, **fields}, file)
                ok += 1
                self.sent += 1
                self.last_error = None
            except TelegramError as exc:
                self.last_error = str(exc)
                logger.warning("Telegram %s to %s failed: %s", method, chat, exc)
        return ok

    # ── Setup helpers (dashboard) ─────────────────────────────────────

    async def check(self) -> dict:
        me = await asyncio.to_thread(self._call, "getMe", {})
        self.bot_name = me.get("username")
        return {"bot_name": self.bot_name}

    async def find_chats(self) -> list[dict]:
        """Groups and people that have recently messaged the bot."""
        await self.check()
        updates = await asyncio.to_thread(self._call, "getUpdates", {"limit": 100})
        chats: dict[str, dict] = {}
        for u in updates:
            for key in ("message", "channel_post", "my_chat_member", "edited_message"):
                c = (u.get(key) or {}).get("chat")
                if c:
                    name = c.get("title") or " ".join(p for p in (c.get("first_name"), c.get("last_name")) if p) or c.get("username")
                    chats[str(c["id"])] = {"id": str(c["id"]), "name": name or str(c["id"]), "type": c.get("type")}
        return list(chats.values())

    async def send_test(self) -> int:
        if not self.chat_ids:
            raise TelegramError("No group chosen yet. Use “Find my group” first.")
        n = await self._send("sendMessage", {
            "text": "✅ <b>SPECTRA is connected.</b>\nAlerts from this venue will appear here.",
            "parse_mode": "HTML"})
        if not n:
            raise TelegramError(self.last_error or "Sending failed")
        return n

    # ── Alerts ────────────────────────────────────────────────────────

    async def on_incident(self, incident_id: str, first: bool) -> None:
        """Called when an alert opens (first=True) or an open alert gets worse."""
        if not self.configured:
            return
        try:
            from app.incidents.store import IncidentStore
            inc = IncidentStore.instance().get(incident_id)
            if not inc:
                return
            level = inc["peak_level"]
            reason = plain(((inc.get("peak_snapshot") or {}).get("reasons") or ["Risk is rising"])[0])
            demo = "\n<i>This is a demo, not a real event.</i>" if inc.get("scenario") else ""
            link = self.dashboard_url(f"/alerts?id={incident_id}")
            if first:
                await self._send("sendMessage", {
                    "text": f"{LEVEL_ICON.get(level, '🚨')} <b>{_e(LEVEL_WORD.get(level, level))} at {_e(inc['zone_name'])}</b>\n"
                            f"{_e(reason)}{demo}\n\n<a href=\"{link}\">Open in SPECTRA</a>",
                    "parse_mode": "HTML", "disable_web_page_preview": "true"})
                await self._send_details(incident_id)
            else:
                await self._send("sendMessage", {
                    "text": f"⬆️ <b>{_e(LEVEL_WORD.get(level, level))} at {_e(inc['zone_name'])}</b> (it got worse)\n{_e(reason)}{demo}",
                    "parse_mode": "HTML"})
        except Exception as exc:  # never let notifications disturb the alert itself
            self.last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("Telegram alert failed: %s", exc, exc_info=True)

    async def _send_details(self, incident_id: str) -> None:
        """Wait for the AI summary and the clip (up to ~30 s), then send both."""
        from app.incidents.store import IncidentStore
        store = IncidentStore.instance()
        for _ in range(30):
            inc = store.get(incident_id)
            if not inc or (inc.get("brief_status") == "ready" and (inc.get("clips") or inc.get("ended_at"))):
                break
            await asyncio.sleep(1)
        inc = store.get(incident_id)
        if not inc:
            return
        b = inc.get("brief") or {}
        lines = [f"<b>{_e(b.get('headline') or 'Crowd risk at ' + inc['zone_name'])}</b>"]
        if b.get("summary"):
            lines.append(_e(plain_summary(b["summary"], b.get("source", "template"))))
        todo = [a for a in b.get("recommended_actions", [])][:3]
        if todo:
            lines.append("\n<b>What to do</b>\n" + "\n".join(f"• {_e(a.get('role'))}: {_e(a.get('action'))}" for a in todo))
        if b.get("pa_announcement_en"):
            lines.append(f"\n<b>Announcement</b>\n{_e(b['pa_announcement_en'])}")
        caption = "\n".join(lines)
        if len(caption) > 1000:  # Telegram's photo caption limit is 1024 characters
            caption = caption[:990].rsplit("\n", 1)[0] + "\n…"
        clip = (inc.get("clips") or [None])[0]
        thumb = INCIDENTS_DIR / clip["thumb_file"] if clip and clip.get("thumb_file") else None
        if thumb and thumb.exists():
            await self._send("sendPhoto", {"caption": caption, "parse_mode": "HTML"},
                             ("photo", thumb.name, thumb.read_bytes(), "image/jpeg"))
        else:
            await self._send("sendMessage", {"text": caption, "parse_mode": "HTML"})

    async def on_incident_closed(self, incident_id: str) -> None:
        """The zone is calm again: send the full report as a file."""
        if not self.configured:
            return
        try:
            from app.api.incidents import incident_announcements
            from app.incidents.store import IncidentStore
            from app.reports.incident_report import build_report
            inc = IncidentStore.instance().get(incident_id)
            if not inc:
                return
            report = await asyncio.to_thread(build_report, inc, incident_announcements(inc))
            minutes = round(((inc.get("ended_at") or time.time()) - inc["started_at"]) / 60, 1)
            await self._send("sendDocument", {
                "caption": f"✅ <b>{_e(inc['zone_name'])} is calm again.</b> The alert lasted {minutes} min. Full report attached; open it in a browser.",
                "parse_mode": "HTML"},
                ("document", f"spectra-report-{incident_id}.html", report.encode("utf-8"), "text/html"))
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("Telegram report failed: %s", exc, exc_info=True)
