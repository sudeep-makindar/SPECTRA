"""
Test: device selection and config loading.
"""

from app.core.device import get_device, device_info
from app.core.config import load_config, AppConfig


def test_get_device_returns_valid_string():
    """Device must be 'mps' or 'cpu'."""
    device = get_device()
    assert device in ("mps", "cpu")


def test_device_info_returns_dict():
    info = device_info()
    assert isinstance(info, dict)
    assert "selected_device" in info
    assert "pytorch_version" in info


def test_load_config_returns_app_config():
    """Config should load without errors using defaults."""
    # Clear cache for isolated test
    load_config.cache_clear()
    config = load_config()
    assert isinstance(config, AppConfig)
    assert config.server.port == 8000
    assert config.fusion.weight_density + config.fusion.weight_motion + config.fusion.weight_audio == pytest.approx(1.0, abs=0.01)
    load_config.cache_clear()


def test_fusion_weights_sum_to_one():
    """Fusion weights must sum to ~1.0 to make risk scores meaningful."""
    load_config.cache_clear()
    config = load_config()
    total = config.fusion.weight_density + config.fusion.weight_motion + config.fusion.weight_audio
    assert 0.95 <= total <= 1.05, f"Fusion weights sum to {total}, expected ~1.0"
    load_config.cache_clear()


def test_hysteresis_thresholds_are_ordered():
    """Up thresholds must be higher than down thresholds to prevent flapping."""
    load_config.cache_clear()
    config = load_config()
    f = config.fusion
    assert f.threshold_elevated_down < f.threshold_elevated_up
    assert f.threshold_high_down < f.threshold_high_up
    assert f.threshold_critical_down < f.threshold_critical_up
    # Ascending order across states
    assert f.threshold_elevated_up < f.threshold_high_up < f.threshold_critical_up
    load_config.cache_clear()


# Need pytest for approx
import pytest
