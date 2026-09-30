# Phase 2 Retro — Perception

## What I Built

1. **YOLO Vision Model (`app/models/vision.py`)**:
   - Integrated `Ultralytics YOLOv8s` for person detection.
   - Configured to filter only `class=0` (person).
   - Generates a naive density score based on a max threshold.

2. **Optical Flow Motion Model (`app/models/motion.py`)**:
   - Used OpenCV's Farneback dense optical flow.
   - Computes motion magnitude per frame and maintains a per-source Exponential Moving Average (EMA) baseline.
   - Generates a `motion_score` (0.0 - 1.0) by measuring how far the current frame's motion spikes above its historical baseline.

3. **AST Audio Model (`app/models/audio.py`)**:
   - Integrated HuggingFace's `ASTForAudioClassification` using the AudioSet fine-tuned checkpoint (`MIT/ast-finetuned-audioset-10-10-0.4593`).
   - Mapped 527 AudioSet classes against our internal `high_risk` threat groups (e.g., Screaming, Gunshots, Explosions) defined in `config.py`.

4. **Perception Manager (`app/perception/workers.py`)**:
   - Created an inference routing layer that takes `SourcePacket`s from the ingestion queues and dispatches them to the appropriate models.
   - **Performance Design**: Rather than heavy multiprocessing IPC (which can be flaky with Apple Silicon MPS/CUDA memory sharing), we used `asyncio.to_thread()`. Because PyTorch and OpenCV release the Python GIL during heavy C++ matrix multiplication, threading gives us true parallelism without the serialization overhead.

5. **Registry Integration (`app/ingest/registry.py`)**:
   - Updated the `SourceRegistry` to spawn a consumer task for each camera. This task continuously pulls frames from the ingestion queue and passes them to the `PerceptionManager` in real-time.

## How I Verified It

- **Model Loading**: Validated that PyTorch correctly identifies the `mps` (Apple Silicon GPU) backend and loads YOLOv8s onto the GPU successfully.
- **Dependency Resolution**: Installed the hefty ML stack (`torch`, `torchvision`, `ultralytics`, `transformers`, `librosa`, `opencv-python-headless`) successfully.
- **Inference Pipeline**: Configured debug logs to verify that `RiskSample` objects (containing the AI scores) are successfully emitted.

## What I Noticed Along the Way

- **Apple Silicon MPS Caveats**: `multiprocessing` with PyTorch on Apple Silicon is extremely brittle because `fork` is disabled and `spawn` requires reloading CUDA/MPS contexts. Switching to `asyncio.to_thread` completely bypassed this issue while maintaining high performance since the GIL is dropped during tensor ops.
- **Audio Checkpoints**: The HuggingFace AST model is ~350MB. The first time the backend starts up, it pauses to download these weights from the HF hub. This requires patience on the first run but caches locally thereafter.
- **Config Mismatch**: `AudioConfig` was missing the `threat_groups` attribute, causing a startup crash. I quickly caught this in the logs and updated the Pydantic schema to include a default dictionary mapping AudioSet classes.

## What I'd Test or Build Next

**Phase 3: Zones & Fusion**
Now that we have raw `RiskSample` objects coming out of the AI models (e.g., YOLO says "Density is 0.8"), we need to fuse them. Phase 3 will build the Fusion Engine which:
1. Groups sources into logical "Zones".
2. Takes the highest risk signal across modalities.
3. Applies EMA smoothing so a single bad frame doesn't trigger a panic.
4. Updates the global `ZoneState` which will finally light up the UI charts!
