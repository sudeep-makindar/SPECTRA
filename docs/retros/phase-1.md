# Phase 1 Retro — Ingestion & Live Feeds

## What I Built

1. **Source Base & Packets (`app/ingest/base.py`)**: 
   - Defined `SourcePacket` for uniform handling of multi-modal data.
   - Defined `BaseSource` interface with an `enqueue` callback to route frames to the registry.
   
2. **Source Registry (`app/ingest/registry.py`)**:
   - Manages source lifecycle and maintains `SourceEntry` states.
   - Implemented bounded `asyncio.Queue` (latest-frame-wins) to prevent latency build-up if processing lags.
   - Built a staleness monitor that checks for dead sources and degrades their status to surface "blind spots".

3. **Source Adapters (`app/ingest/adapters.py`)**:
   - `FileLoopSource`: Infinite loop of video file (for repeatable dev).
   - `SimulatedSource`: Generates synthetic frames with colored backgrounds (calm → panic) and a clear `SIM` label.
   - `LocalWebcamSource`: Captures local camera via OpenCV.
   - `RtspHttpVideoSource`: Captures RTSP streams with exponential backoff for reconnects.

4. **WebSocket Handlers (`app/ws/handlers.py`)**:
   - `/ws/live`: Pushes aggregated state to the dashboard at 2Hz.
   - `/ws/node`: Binary protocol ingestion for Browser Nodes.
   - `/ws/preview/{source_id}`: Per-source JPEG streaming for the dashboard.

5. **API Updates**:
   - Full CRUD in `/api/sources` with automatic adapter generation and token issuance for browser nodes.

6. **Frontend Integration**:
   - `useSpectraSocket` hook for auto-reconnecting to the live state stream.
   - `CameraTile` component showcasing live previews, stats, SIM/LIVE badges, and a "Blind Spot" overlay.
   - `AddSourceDialog` integrated directly into the `OverviewPage`.
   - Dedicated `NodePage` (`/node`) that uses `getUserMedia` to send JPEG frames over the `/ws/node` WebSocket.

7. **Tools & Docs**:
   - `scripts/make_https.sh` to generate self-signed certs for local network node testing.
   - `docs/REMOTE_NODES.md` explaining the browser HTTPS requirement and how to connect nodes.
   - Added OpenCV (`opencv-python-headless`) for video capture/manipulation.
   - Generated `data/test_loop.mp4` via script to validate `FileLoopSource`.

## How I Verified It

1. **OpenCV Setup**: Verified the `FileLoopSource` using a generated OpenCV test video (`data/test_loop.mp4`).
2. **API & Status Tracking**: Created the test source via the API. The registry updated `last_seen`, `fps` (4.9 fps), and transitioned the source to `online`.
3. **Queue Mechanism**: Verified that `dropped_frames` increases when the queue is full and no consumer is emptying it, validating the latest-wins backpressure mechanic.
4. **Build & Syntax**: Verified `npm run build` succeeds and Pytest passes for existing modules.

## What I Noticed Along the Way

1. **Direct Queue Mutation**: Initially, the adapters called `queue.put()` directly on the raw `asyncio.Queue`. This bypassed the registry's status updates, FPS tracking, and metrics collection. I fixed this by refactoring `BaseSource.start()` to accept an `enqueue` callback, ensuring all packets flow through `SourceEntry.enqueue()`.
2. **HTTPS on Local LAN**: Browsers firmly reject `getUserMedia` without HTTPS. While `localhost` bypasses this rule, connecting a phone to `http://192.168.x.x:5173` fails silently. A self-signed cert helper and robust documentation were essential to unblock this core use case.

## What I Added Beyond the Spec

1. **Degraded Overlay ("Blind Spot")**: If a source goes offline but isn't explicitly deleted, the `CameraTile` darkens and prominently displays a warning with the time since last seen. This is critical for operators to know exactly when a feed died.
2. **Simulated Source Detail**: The `SimulatedSource` doesn't just loop; it actively draws circles and shifts color to mimic different crowd states (calm, building, panic), which will be extremely useful for testing the state machine in Phase 3.

## What I'm Not Happy With

- The `/ws/preview` endpoint uses a polling mechanism (`entry.queue.get_nowait()`) on the main ingestion queue to extract preview frames. In a heavy production load, taking packets directly out of the inference queue might cause inference to skip those frames if not put back fast enough. A proper pub/sub fanout for preview frames would be safer.

## Proposals (Tier 3)

1. **Pub/Sub Frame Router**: Instead of `SourceEntry` having a single queue, it should have a central broadcaster that sends frames to an `inference_queue` and zero or more `preview_queues`. This prevents dashboard clients from affecting the AI ingestion pipeline.

## What I'd Test or Build Next

**Phase 2: Perception**
1. Bring in the YOLO model for person counting.
2. Implement OpenCV Optical Flow for baseline-relative motion tracking.
3. Bring in the AST model for audio classification.
4. Wire up the `VisionWorker` and `AudioWorker` processes to pull from the source queues.
