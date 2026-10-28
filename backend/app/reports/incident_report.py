"""
Incident report — one alert as a single, self-contained HTML file.

Timeline chart, frames from the evidence clip, the AI summary, what the
sensors showed at the peak, every action taken and every announcement made.
Images are embedded, so the file can be emailed, sent on Telegram or opened
offline; the browser's Print turns it into a PDF.
"""

from __future__ import annotations

import base64
import html
import time

import cv2

from app.core.config import INCIDENTS_DIR
from app.reports.plain import CROWDING, LEVEL_WORD, plain, plain_summary

STATUS_WORD = {"open": "Waiting for someone", "acknowledged": "Someone is on it",
               "escalated": "Escalated", "resolved": "Resolved"}
LEVEL_COLOR = {"normal": "#6b6965", "elevated": "#b07a12", "high": "#cf5b22", "critical": "#c62d2a"}
ACTION_WORD = {"opened": "Alert opened", "acknowledged": "Someone is on it", "acknowledge": "Someone is on it",
               "escalated_auto": "Got worse", "escalate": "Escalated", "resolved": "Marked resolved",
               "resolve": "Marked resolved", "reopen": "Reopened", "reopened": "Reopened", "closed": "Calm again",
               "briefed": "AI summary written", "clip_saved": "Video clip saved"}


def _e(s: object) -> str:
    return html.escape(str(s if s is not None else ""))


def _clock(ts: float) -> str:
    return time.strftime("%H:%M:%S", time.localtime(ts))


def _duration(a: float, b: float | None) -> str:
    s = round((b or time.time()) - a)
    return f"{s} s" if s < 60 else f"{s // 60} min {s % 60} s"


def clip_frames(inc: dict, count: int = 4, width: int = 480) -> list[tuple[float, str]]:
    """Evenly spaced frames from the first clip, as (seconds into clip, data URI)."""
    for clip in inc.get("clips", []):
        path = INCIDENTS_DIR / clip.get("file", "")
        cap = cv2.VideoCapture(str(path))
        total, fps = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), cap.get(cv2.CAP_PROP_FPS) or 5.0
        out = []
        for i in range(count):
            idx = int((i + 0.5) * total / count)
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            if w > width:
                frame = cv2.resize(frame, (width, int(h * width / w)))
            jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])[1].tobytes()
            out.append((idx / fps, "data:image/jpeg;base64," + base64.b64encode(jpg).decode()))
        cap.release()
        if out:
            return out
        thumb = INCIDENTS_DIR / clip.get("thumb_file", "")
        if thumb.exists():
            return [(clip.get("trigger_offset_s", 0), "data:image/jpeg;base64," + base64.b64encode(thumb.read_bytes()).decode())]
    return []


def _timeline_svg(points: list[list[float]]) -> str:
    """Combined risk (solid) and each sense (grey, dashed) with the three alert lines."""
    if len(points) < 2:
        return "<p class='muted'>Not enough data to draw a timeline.</p>"
    W, H, L, R, T, B = 760, 230, 36, 110, 12, 26
    t0, t1 = points[0][0], points[-1][0]
    span = max(t1 - t0, 1)
    x = lambda t: L + (t - t0) / span * (W - L - R)  # noqa: E731
    y = lambda v: T + (1 - max(0.0, min(1.0, v))) * (H - T - B)  # noqa: E731
    parts = [f"<svg viewBox='0 0 {W} {H}' role='img' aria-label='Risk over time during this alert'>"]
    for v, word, color in ((0.30, "Watch", "#b07a12"), (0.55, "Needs attention", "#cf5b22"), (0.80, "Act now", "#c62d2a")):
        parts.append(f"<line x1='{L}' x2='{W - R}' y1='{y(v):.1f}' y2='{y(v):.1f}' stroke='{color}' stroke-dasharray='4 4' stroke-width='1'/>"
                     f"<text x='{W - R + 6}' y='{y(v) + 4:.1f}' fill='{color}' font-size='11'>{word}</text>")
    for idx, name, dash, width_ in ((2, "Crowd", "2 3", 1.4), (3, "Movement", "6 3", 1.4), (4, "Sound", "1 2", 1.4), (1, "Combined risk", "", 2.6)):
        pts = " ".join(f"{x(p[0]):.1f},{y(p[idx]):.1f}" for p in points)
        color = "#1c1e22" if idx == 1 else "#8b8e93"
        parts.append(f"<polyline points='{pts}' fill='none' stroke='{color}' stroke-width='{width_}'"
                     + (f" stroke-dasharray='{dash}'" if dash else "") + "/>")
    for i, (label, dash, color) in enumerate((("Combined risk", "", "#1c1e22"), ("Crowd", "2 3", "#8b8e93"),
                                               ("Movement", "6 3", "#8b8e93"), ("Sound", "1 2", "#8b8e93"))):
        lx = L + i * 150
        parts.append(f"<line x1='{lx}' x2='{lx + 22}' y1='{H - 8}' y2='{H - 8}' stroke='{color}' stroke-width='2'"
                     + (f" stroke-dasharray='{dash}'" if dash else "") + f"/><text x='{lx + 28}' y='{H - 4}' font-size='11' fill='#55595f'>{label}</text>")
    parts.append(f"<text x='{L}' y='{T + 8}' font-size='10' fill='#8b8e93' text-anchor='end' dx='-4'>100</text>"
                 f"<text x='{L}' y='{H - B}' font-size='10' fill='#8b8e93' text-anchor='end' dx='-4'>0</text>"
                 f"<text x='{L}' y='{H - B + 12}' font-size='10' fill='#8b8e93'>{_clock(t0)}</text>"
                 f"<text x='{W - R}' y='{H - B + 12}' font-size='10' fill='#8b8e93' text-anchor='end'>{_clock(t1)}</text></svg>")
    return "".join(parts)


def build_report(inc: dict, announcements: list[dict] | None = None) -> str:
    b = inc.get("brief") or {}
    peak = inc.get("peak_snapshot") or {}
    level = inc.get("peak_level", "high")
    color = LEVEL_COLOR.get(level, "#c62d2a")
    headline = b.get("headline") or f"Crowd risk at {inc['zone_name']}"
    frames = clip_frames(inc)
    clip = (inc.get("clips") or [{}])[0]

    reasons = "".join(f"<li>{_e(plain(r))}</li>" for r in (peak.get("reasons") or [])[:4])
    actions = "".join(
        f"<li><b>{_e(a.get('role'))}:</b> {_e(a.get('action'))}" + (" <span class='now'>Now</span>" if a.get("priority") == "now" else "") + "</li>"
        for a in b.get("recommended_actions", []))
    log = "".join(
        f"<tr><td class='mono'>{_clock(entry['ts'])}</td><td>{_e(ACTION_WORD.get(entry['action'], entry['action'].replace('_', ' ').capitalize()))}</td>"
        f"<td>{_e({'operator': 'Operator', 'system': 'SPECTRA', 'copilot': 'AI assistant'}.get(entry.get('by'), entry.get('by')))}</td>"
        f"<td>{_e(plain(entry.get('note', '')))}</td></tr>"
        for entry in inc.get("log", []))
    anns = "".join(
        f"<div class='say'><div class='muted small'>{_clock(a['ts'])} · {_e(a['zone_name'])}</div>"
        + "".join(f"<p>{_e(i['text'])}</p>" for i in a["items"]) + "</div>"
        for a in (announcements or []))
    frames_html = "".join(
        f"<figure><img src='{src}' alt='Frame {i + 1} from the evidence clip'><figcaption>{t:.1f} s into the clip</figcaption></figure>"
        for i, (t, src) in enumerate(frames))
    sound = peak.get("audio_label") or "Nothing alarming"
    if peak.get("keyword"):
        sound += f" · heard “{peak['keyword']}”"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPECTRA alert report · {_e(inc['zone_name'])} · {time.strftime('%d %b %Y %H:%M', time.localtime(inc['started_at']))}</title>
<style>
  :root {{ --ink:#1c1e22; --ink2:#55595f; --ink3:#8b8e93; --line:#e5e2db; --soft:#f4f3f0; --risk:{color}; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#fff; color:var(--ink); font:15px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif; }}
  main {{ max-width:860px; margin:0 auto; padding:32px max(20px, env(safe-area-inset-left)); }}
  header {{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid var(--ink); padding-bottom:16px; }}
  h1 {{ font-size:28px; line-height:1.15; margin:8px 0 6px; letter-spacing:-0.01em; }}
  h2 {{ font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink3); margin:32px 0 10px; }}
  .badge {{ display:inline-block; padding:3px 10px; border-radius:999px; font-weight:700; font-size:13px; color:#fff; background:var(--risk); }}
  .tag {{ display:inline-block; padding:3px 10px; border-radius:999px; font-size:13px; background:var(--soft); color:var(--ink2); margin-left:6px; }}
  .muted {{ color:var(--ink2); }} .small {{ font-size:13px; }} .mono {{ font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; white-space:nowrap; }}
  .brand {{ font-weight:800; letter-spacing:.06em; font-size:13px; color:var(--ink2); }}
  .facts {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:18px; }}
  .fact {{ background:var(--soft); border-radius:10px; padding:10px 12px; }} .fact b {{ display:block; font-size:20px; }} .fact span {{ font-size:12px; color:var(--ink2); }}
  ul {{ margin:6px 0; padding-left:20px; }} li {{ margin:4px 0; }}
  .now {{ background:var(--risk); color:#fff; border-radius:6px; font-size:11px; font-weight:700; padding:1px 6px; }}
  svg {{ width:100%; height:auto; display:block; }}
  .frames {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }}
  figure {{ margin:0; }} figure img {{ width:100%; border-radius:8px; display:block; }} figcaption {{ font-size:12px; color:var(--ink3); margin-top:4px; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }} td {{ border-top:1px solid var(--line); padding:8px 8px 8px 0; vertical-align:top; }}
  .say {{ background:var(--soft); border-radius:10px; padding:10px 14px; margin-bottom:8px; }} .say p {{ margin:4px 0; }}
  .box {{ border:1px solid var(--line); border-radius:12px; padding:14px 16px; }}
  footer {{ margin-top:36px; padding-top:12px; border-top:1px solid var(--line); font-size:12px; color:var(--ink3); }}
  button {{ font:inherit; padding:8px 16px; border-radius:999px; border:1px solid var(--ink); background:var(--ink); color:#fff; cursor:pointer; }}
  @media (max-width:640px) {{ .facts {{ grid-template-columns:repeat(2,1fr); }} .frames {{ grid-template-columns:1fr; }} header {{ flex-direction:column; }} }}
  @media print {{ button {{ display:none; }} main {{ padding:0; }} h2 {{ break-after:avoid; }} figure, .box {{ break-inside:avoid; }} }}
</style></head>
<body><main>
<header>
  <div>
    <div class="brand">SPECTRA · ALERT REPORT</div>
    <h1>{_e(headline)}</h1>
    <div><span class="badge">{_e(LEVEL_WORD.get(level, level))}</span><span class="tag">{_e(STATUS_WORD.get(inc.get('status'), inc.get('status')))}</span>{"<span class='tag'>Demo</span>" if inc.get('scenario') else ""}</div>
  </div>
  <button onclick="window.print()">Print / save as PDF</button>
</header>

<div class="facts">
  <div class="fact"><b>{_e(inc['zone_name'])}</b><span>zone</span></div>
  <div class="fact"><b>{_clock(inc['started_at'])}</b><span>{time.strftime('%d %b %Y', time.localtime(inc['started_at']))}</span></div>
  <div class="fact"><b>{_duration(inc['started_at'], inc.get('ended_at'))}</b><span>{'lasted' if inc.get('ended_at') else 'so far, still happening'}</span></div>
  <div class="fact"><b>{round(inc.get('peak_risk', 0) * 100)}/100</b><span>highest risk</span></div>
</div>

<h2>What happened</h2>
<div class="box">
  <p style="margin-top:0">{_e(plain_summary(b.get('summary', ''), b.get('source', 'template'))) or 'No summary was written for this alert.'}</p>
  {f"<p class='muted'><b>Most likely:</b> {_e(b['likely_situation'])}</p>" if b.get('likely_situation') else ""}
  {f"<p class='muted' style='margin-bottom:0'><b>Could it be a false alarm?</b> {_e(b['false_alarm_check'])}</p>" if b.get('false_alarm_check') else ""}
  <p class="muted small" style="margin-bottom:0">{'Written by the AI assistant from sensor numbers only' if b.get('source') == 'llm' else 'Written from built-in templates'}{f" · {_e(b.get('confidence'))} confidence" if b.get('confidence') else ""}</p>
</div>

<h2>Risk during the alert</h2>
{_timeline_svg(inc.get('timeline') or [])}

<h2>What the sensors showed at the peak</h2>
<div class="facts">
  <div class="fact"><b>{_e(peak.get('people_count', '–'))}</b><span>people in view</span></div>
  <div class="fact"><b>{_e(CROWDING.get(peak.get('los', ''), '–'))}</b><span>{(peak.get('density_ppm2') or 0):.1f} people per m²</span></div>
  <div class="fact"><b>{round(((peak.get('motion') or {}).get('score') or 0) * 100)}</b><span>movement score</span></div>
  <div class="fact"><b style="font-size:15px">{_e(sound)}</b><span>sound</span></div>
</div>
{f"<ul>{reasons}</ul>" if reasons else ""}
{f"<p class='muted'>Speech heard: “{_e(peak['transcript'])}”</p>" if peak.get('transcript') else ""}

<h2>Video evidence</h2>
{f"<div class='frames'>{frames_html}</div><p class='muted small'>From {_e(clip.get('source_id', 'the camera'))}: {clip.get('duration_s', '?')} s clip around the moment the alert opened{', faces blurred' if clip.get('face_blur') else ''}.</p>" if frames else "<p class='muted'>No camera covered this zone, so there is no clip.</p>"}

{f"<h2>What to do</h2><ul>{actions}</ul>" if actions else ""}

<h2>Actions taken</h2>
<table>{log}</table>

{f"<h2>Announcements</h2>{anns}" if anns else ""}

<footer>Report {_e(inc['id'])} · created {time.strftime('%d %b %Y %H:%M:%S')} by SPECTRA, a decision-support prototype, not a certified safety system.</footer>
</main></body></html>"""
