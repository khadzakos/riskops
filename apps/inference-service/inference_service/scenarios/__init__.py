"""Stress testing / market simulation scenarios for the Inference Service.

Public API:
    SCENARIOS          — dict of built-in scenario definitions
    run_scenario()     — execute a scenario and return StressResult
    StressRequest      — input dataclass
    StressResult       — output dataclass
"""
from .engine import SCENARIOS, StressRequest, StressResult, run_scenario

__all__ = ["SCENARIOS", "StressRequest", "StressResult", "run_scenario"]
