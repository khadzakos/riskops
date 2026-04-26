"""Kafka consumer for the Inference Service.

Listens on two topics:
  - `portfolio.updated`  — triggers automatic risk recalculation for the portfolio
  - `model.trained`      — hot-reloads the new model version into the registry

Both consumers run in a single background daemon thread.

Reliability improvements:
  - Exponential backoff retry for transient failures (e.g. market data not yet ingested)
  - Dead-letter logging for permanently failed events
  - Separate error handling per event type
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Optional

import socket

from kafka import KafkaConsumer
from kafka.errors import KafkaError, NoBrokersAvailable

from .config import get_settings
from .models.loader import get_registry, reload_model
from .models.predictor import predict

logger = logging.getLogger(__name__)

_RETRY_INTERVAL_S = 10
_MAX_RETRIES = 30  # ~5 minutes before giving up

# Retry config for portfolio.updated risk recalculation
_PREDICT_MAX_ATTEMPTS = 3
_PREDICT_RETRY_BASE_S = 5.0   # exponential backoff base


def _build_consumer(
    brokers: list[str],
    group_id: str,
    topics: list[str],
) -> KafkaConsumer:
    """Create a KafkaConsumer subscribed to multiple topics, with retry logic."""
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            consumer = KafkaConsumer(
                *topics,
                bootstrap_servers=brokers,
                group_id=group_id,
                auto_offset_reset="latest",
                enable_auto_commit=True,
                value_deserializer=lambda v: json.loads(v.decode("utf-8")),
                consumer_timeout_ms=5_000,
                session_timeout_ms=60_000,
                heartbeat_interval_ms=20_000,
                max_poll_interval_ms=300_000,
            )
            logger.info(
                "Kafka consumer connected to %s, topics=%s, group=%s",
                brokers, topics, group_id,
            )
            return consumer
        except (NoBrokersAvailable, KafkaError, socket.gaierror, OSError) as exc:
            logger.warning(
                "Kafka not available (attempt %d/%d, error=%s), retrying in %ds…",
                attempt, _MAX_RETRIES, exc, _RETRY_INTERVAL_S,
            )
            time.sleep(_RETRY_INTERVAL_S)

    raise RuntimeError(
        f"Could not connect to Kafka brokers {brokers} after {_MAX_RETRIES} attempts"
    )


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

def _handle_portfolio_updated(event: dict) -> None:
    """Trigger risk recalculation when a portfolio's positions change.

    Uses exponential backoff retry to handle the case where market data
    has not yet been ingested for the portfolio's symbols.
    """
    portfolio_id = event.get("portfolio_id")
    if portfolio_id is None:
        logger.warning("portfolio.updated event missing portfolio_id, skipping")
        return

    try:
        portfolio_id = int(portfolio_id)
    except (TypeError, ValueError):
        logger.warning("portfolio.updated: invalid portfolio_id=%r", portfolio_id)
        return

    action = event.get("action", "unknown")
    # Skip deletion events — no point computing risk for a deleted portfolio/position
    if action in ("portfolio_deleted",):
        logger.debug("Skipping risk recalculation for action=%s portfolio=%d", action, portfolio_id)
        return

    cfg = get_settings()
    registry = get_registry()

    logger.info(
        "portfolio.updated received: portfolio_id=%d  action=%s — triggering risk recalculation",
        portfolio_id, action,
    )

    # Determine best available method
    if registry.get("garch") is not None:
        method = "garch"
    elif registry.get("montecarlo") is not None:
        method = "montecarlo"
    else:
        method = "historical"

    # Import here to avoid circular import at module level
    from .api.routes import _store_risk_results

    last_exc: Optional[Exception] = None
    for attempt in range(1, _PREDICT_MAX_ATTEMPTS + 1):
        try:
            result = predict(
                portfolio_id=portfolio_id,
                method=method,
                registry=registry,
                alpha=cfg.default_alpha,
                horizon_days=cfg.default_horizon_days,
                lookback_days=cfg.default_lookback_days,
                n_simulations=cfg.monte_carlo_simulations,
            )
            _store_risk_results(result)
            logger.info(
                "Auto risk recalculation done: portfolio=%d  method=%s  VaR=%.6f  CVaR=%.6f  (attempt %d)",
                portfolio_id, result.method, result.var, result.cvar, attempt,
            )
            return  # success — exit retry loop
        except (ValueError, RuntimeError) as exc:
            last_exc = exc
            # These are data-related errors (no positions, no market data).
            # Retry with exponential backoff in case data is being ingested concurrently.
            wait = _PREDICT_RETRY_BASE_S * (2 ** (attempt - 1))
            logger.warning(
                "Risk recalculation attempt %d/%d failed for portfolio=%d: %s — "
                "retrying in %.1fs",
                attempt, _PREDICT_MAX_ATTEMPTS, portfolio_id, exc, wait,
            )
            if attempt < _PREDICT_MAX_ATTEMPTS:
                time.sleep(wait)
        except Exception as exc:
            last_exc = exc
            logger.exception(
                "Unexpected error in risk recalculation for portfolio=%d (attempt %d): %s",
                portfolio_id, attempt, exc,
            )
            break  # don't retry unexpected errors

    logger.error(
        "Auto risk recalculation permanently failed for portfolio_id=%d after %d attempts: %s",
        portfolio_id, _PREDICT_MAX_ATTEMPTS, last_exc,
    )


def _handle_model_trained(event: dict) -> None:
    """Hot-reload a newly trained model version into the registry."""
    model_name = event.get("model_name")
    model_version = event.get("version") or event.get("model_version")

    if not model_name or not model_version:
        logger.warning(
            "model.trained event missing model_name or version: %s", event
        )
        return

    logger.info(
        "model.trained received: model=%s version=%s — hot-reloading",
        model_name, model_version,
    )

    success = reload_model(model_name=model_name, model_version=str(model_version))
    if success:
        logger.info("Hot-reload successful: %s v%s", model_name, model_version)
    else:
        logger.error("Hot-reload failed: %s v%s", model_name, model_version)


# ---------------------------------------------------------------------------
# Consumer loop
# ---------------------------------------------------------------------------

def _consumer_loop(stop_event: threading.Event) -> None:
    """Main consumer loop. Runs until stop_event is set."""
    cfg = get_settings()
    brokers = [b.strip() for b in cfg.kafka_brokers.split(",")]
    topics = [
        cfg.kafka_topic_portfolio_updated,
        cfg.kafka_topic_model_trained,
    ]

    try:
        consumer = _build_consumer(
            brokers=brokers,
            group_id=cfg.kafka_consumer_group,
            topics=topics,
        )
    except RuntimeError as exc:
        logger.error(
            "Kafka consumer startup failed: %s — auto-inference and hot-reload disabled",
            exc,
        )
        return

    logger.info("Kafka consumer loop started (topics=%s)", topics)
    try:
        while not stop_event.is_set():
            try:
                records = consumer.poll(timeout_ms=5_000)
                for tp, messages in records.items():
                    for msg in messages:
                        topic = tp.topic
                        try:
                            if topic == cfg.kafka_topic_portfolio_updated:
                                _handle_portfolio_updated(msg.value)
                            elif topic == cfg.kafka_topic_model_trained:
                                _handle_model_trained(msg.value)
                            else:
                                logger.debug("Unhandled topic: %s", topic)
                        except Exception as exc:
                            logger.exception(
                                "Error handling message topic=%s offset=%d: %s",
                                topic, msg.offset, exc,
                            )
            except Exception as exc:
                logger.exception("Kafka poll error: %s", exc)
                time.sleep(5)
    finally:
        consumer.close()
        logger.info("Kafka consumer closed")


class KafkaConsumerThread:
    """Manages the Kafka consumer background thread lifecycle."""

    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            logger.warning("Kafka consumer thread already running")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=_consumer_loop,
            args=(self._stop_event,),
            daemon=True,
            name="kafka-consumer",
        )
        self._thread.start()
        logger.info("Kafka consumer thread started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=15)
            logger.info("Kafka consumer thread stopped")
