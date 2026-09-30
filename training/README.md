# Spectra — Fine-Tuning (Phase 7)

> This directory is a stub. The architecture supports swapping pretrained models
> for fine-tuned ones via the model registry, but actual fine-tuning is not
> implemented yet.

## Planned Targets

### 1. Audio: Scream/Gunshot Classifier
- Fine-tune the AST model on a public scream/gunshot dataset
- Compare before/after using the Phase 5 evaluation harness
- Dataset candidates: ESC-50 (scream subset), UrbanSound8K, AudioSet eval

### 2. Motion: Panic Classifier (Optional)
- Lightweight classifier on optical-flow feature vectors
- Train on extracted features from UMN crowd anomaly dataset
- Input: [mean_magnitude, magnitude_zscore, divergence, direction_entropy, sudden_change]

## How Model Switching Works

In `config/app.yaml`:
```yaml
audio:
  model_mode: "pretrained"          # Uses MIT/ast-finetuned-audioset
  # model_mode: "finetuned:checkpoints/audio_scream_v1.pt"  # Uses fine-tuned
```

The model registry (`backend/app/models/registry.py`) loads the correct checkpoint
based on this config. No pipeline changes needed.

## Requirements
- Apple Silicon (MPS) or cloud GPU for training
- Dataset licenses must be checked before use
- Training scripts must produce reproducible results (fixed seeds, logged hyperparams)

## Files (to be created)
```
training/
  configs/
    audio_finetune.yaml     # Hyperparameters
    motion_finetune.yaml
  scripts/
    finetune_audio.py       # Training script
    finetune_motion.py
    export_model.py         # Convert to inference format
  README.md                 # This file
```
