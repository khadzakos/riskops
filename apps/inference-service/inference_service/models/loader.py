"""MLflow model loader for the Inference Service.

Loads the latest production GARCH model from the MLflow Model Registry on startup,
and supports hot-reloading when a `model.trained` Kafka event arrives.

Architecture:
  - GARCH model: stored as a pickled ARCHModelResult artifact under `model/` path.
  - Monte Carlo: stored as a JSON artifact with GBM params (mu, sigma, cov matrix).
  - Historical: no model needed — computed directly from processed_returns.

The loader maintains a thread-safe in-memory cache of the current active model.
"""
from __future__ import annotations

import logging
import os
import pickle
import threading
import tempfile
from dataclasses import dataclass, field
from typing import Any, Optional

import mlflow
from mlflow.tracking import MlflowClient

from ..config import get_settings

logger = logging.getLogger(__name__)

# MLflow registered model names (must match training-service)
GARCH_MODEL_NAME = "riskops-garch"
MONTECARLO_MODEL_NAME = "riskops-montecarlo"


@dataclass
class LoadedModel:
    """Container for a loaded model artifact and its metadata."""
    model_type: str          # garch | montecarlo
    model_name: str          # MLflow registered model name
    model_version: str       # MLflow model version string
    run_id: str              # MLflow run ID
    artifact: Any            # The actual model object (ARCHModelResult or dict)
    metrics: dict = field(default_factory=dict)


def _setup_mlflow() -> None:
    """Configure MLflow tracking URI and S3 credentials."""
    cfg = get_settings()
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", cfg.mlflow_s3_endpoint_url)
    os.environ.setdefault("AWS_ACCESS_KEY_ID", cfg.aws_access_key_id)
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", cfg.aws_secret_access_key)


def _get_latest_version(client: MlflowClient, model_name: str) -> Optional[str]:
    """Return the latest version number for a registered model, or None if not found."""
    try:
        versions = client.get_latest_versions(model_name)
        if not versions:
            return None
        # Prefer Production stage, then Staging, then any
        for stage in ("Production", "Staging", "None"):
            for v in versions:
                if v.current_stage == stage:
                    return v.version
        return versions[0].version
    except mlflow.exceptions.MlflowException as exc:
        logger.warning("Could not fetch versions for model %s: %s", model_name, exc)
        return None


def _download_artifact(client: MlflowClient, run_id: str, artifact_path: str) -> str:
    """Download an artifact from MLflow to a local temp directory.

    Returns the local path to the downloaded file/directory.
    """
    tmp_dir = tempfile.mkdtemp(prefix="riskops-inference-")
    local_path = client.download_artifacts(run_id, artifact_path, tmp_dir)
    return local_path


def load_garch_model(client: MlflowClient, version: str) -> Optional[LoadedModel]:
    """Load a GARCH model artifact from MLflow.

    The training service stores the pickled ARCHModelResult under `model/` artifact path.
    We download the pickle file and deserialise it.
    """
    try:
        mv = client.get_model_version(GARCH_MODEL_NAME, version)
        run_id = mv.run_id

        # Download the model artifact directory
        local_dir = _download_artifact(client, run_id, "model")

        # Find the .pkl file inside the downloaded directory
        pkl_path: Optional[str] = None
        if os.path.isfile(local_dir) and local_dir.endswith(".pkl"):
            pkl_path = local_dir
        elif os.path.isdir(local_dir):
            for fname in os.listdir(local_dir):
                if fname.endswith(".pkl"):
                    pkl_path = os.path.join(local_dir, fname)
                    break

        if pkl_path is None:
            logger.warning(
                "No .pkl file found in GARCH model artifact for version %s (run_id=%s)",
                version, run_id,
            )
            return None

        with open(pkl_path, "rb") as f:
            arch_result = pickle.load(f)

        # Fetch metrics from the run
        run = client.get_run(run_id)
        metrics = dict(run.data.metrics)

        logger.info(
            "Loaded GARCH model version=%s run_id=%s  VaR=%.6f  CVaR=%.6f",
            version, run_id,
            metrics.get("var", float("nan")),
            metrics.get("cvar", float("nan")),
        )

        return LoadedModel(
            model_type="garch",
            model_name=GARCH_MODEL_NAME,
            model_version=version,
            run_id=run_id,
            artifact=arch_result,
            metrics=metrics,
        )

    except Exception as exc:
        logger.error("Failed to load GARCH model version=%s: %s", version, exc)
        return None


def load_montecarlo_model(client: MlflowClient, version: str) -> Optional[LoadedModel]:
    """Load a Monte Carlo pyfunc model from MLflow.

    The training service stores the model as a proper mlflow.pyfunc model
    (MonteCarloModel instance) under the 'model/' artifact path.
    We load it with mlflow.pyfunc.load_model() so the Inference Service can
    call pyfunc_model.predict(input_df) directly.
    """
    try:
        import mlflow.pyfunc

        mv = client.get_model_version(MONTECARLO_MODEL_NAME, version)
        run_id = mv.run_id

        # Load the pyfunc model from the MLflow run URI
        model_uri = f"runs:/{run_id}/model"
        pyfunc_model = mlflow.pyfunc.load_model(model_uri)

        run = client.get_run(run_id)
        metrics = dict(run.data.metrics)

        logger.info(
            "Loaded Monte Carlo pyfunc model version=%s run_id=%s  VaR=%.6f  CVaR=%.6f",
            version, run_id,
            metrics.get("var", float("nan")),
            metrics.get("cvar", float("nan")),
        )

        return LoadedModel(
            model_type="montecarlo",
            model_name=MONTECARLO_MODEL_NAME,
            model_version=version,
            run_id=run_id,
            artifact=pyfunc_model,   # mlflow.pyfunc.PyFuncModel — has .predict()
            metrics=metrics,
        )

    except Exception as exc:
        logger.error("Failed to load Monte Carlo pyfunc model version=%s: %s", version, exc)
        return None


class ModelRegistry:
    """Thread-safe in-memory registry of loaded models.

    Holds the currently active model per model_type.
    Supports hot-reload via `reload_model()`.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._models: dict[str, LoadedModel] = {}  # model_type → LoadedModel

    def get(self, model_type: str) -> Optional[LoadedModel]:
        with self._lock:
            return self._models.get(model_type)

    def set(self, model: LoadedModel) -> None:
        with self._lock:
            self._models[model.model_type] = model
            logger.info(
                "Model registry updated: type=%s version=%s",
                model.model_type, model.model_version,
            )

    def loaded_types(self) -> list[str]:
        with self._lock:
            return list(self._models.keys())

    def is_empty(self) -> bool:
        with self._lock:
            return len(self._models) == 0


# Module-level singleton registry
_registry = ModelRegistry()


def get_registry() -> ModelRegistry:
    """Return the global model registry singleton."""
    return _registry


def load_all_models() -> None:
    """Load the latest versions of all registered models from MLflow.

    Called on service startup. Failures are logged but do not crash the service —
    the service falls back to historical simulation if no ML model is available.
    """
    _setup_mlflow()
    client = MlflowClient()

    # Load GARCH
    garch_version = _get_latest_version(client, GARCH_MODEL_NAME)
    if garch_version:
        model = load_garch_model(client, garch_version)
        if model:
            _registry.set(model)
    else:
        logger.warning(
            "No GARCH model found in MLflow registry (%s) — will use historical fallback",
            GARCH_MODEL_NAME,
        )

    # Load Monte Carlo
    mc_version = _get_latest_version(client, MONTECARLO_MODEL_NAME)
    if mc_version:
        model = load_montecarlo_model(client, mc_version)
        if model:
            _registry.set(model)
    else:
        logger.warning(
            "No Monte Carlo model found in MLflow registry (%s)",
            MONTECARLO_MODEL_NAME,
        )

    if _registry.is_empty():
        logger.warning(
            "No ML models loaded — all predictions will use historical simulation fallback"
        )
    else:
        logger.info("Model registry loaded: %s", _registry.loaded_types())


def reload_model(model_name: str, model_version: str) -> bool:
    """Hot-reload a specific model version.

    Called when a `model.trained` Kafka event arrives.
    Returns True if the model was successfully loaded and registered.
    """
    _setup_mlflow()
    client = MlflowClient()

    if model_name == GARCH_MODEL_NAME:
        model = load_garch_model(client, model_version)
    elif model_name == MONTECARLO_MODEL_NAME:
        model = load_montecarlo_model(client, model_version)
    else:
        logger.warning("Unknown model name for hot-reload: %s", model_name)
        return False

    if model is None:
        return False

    _registry.set(model)
    logger.info("Hot-reloaded model: %s v%s", model_name, model_version)
    return True
