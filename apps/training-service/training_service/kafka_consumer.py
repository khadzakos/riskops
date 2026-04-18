"""Kafka consumer for the Training Service.

Listens on the `market.data.ingested` topic and triggers model retraining
whenever new market data arrives.

The consumer runs in a background daemon thread started from main.py.
Training jobs are dispatched to a ThreadPoolExecutor so the poll loop
(and Kafka heartbeats) are never blocked by long-running training.
"""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from kafka import KafkaConsumer
from kafka.errors import KafkaError, NoBrokersAvailable

from .config import get_settings
from .pipelines.train import TrainRequest, run_training

logger = logging.getLogger(__name__)

_RETRY_INTERVAL_S = 10
_MAX_RETRIES = 30  # ~5 minutes of retries before giving up
_TRAINING_WORKERS = 2  # concurrent training jobs allowed


def _build_consumer(brokers: list[str], group_id: str, topic: str) -> KafkaConsumer:
    """Create a KafkaConsumer with retry logic for broker availability."""
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            consumer = KafkaConsumer(
                topic,
                bootstrap_servers=brokers,
                group_id=group_id,
                auto_offset_reset="latest",
                enable_auto_commit=True,
                value_deserializer=lambda v: json.loads(v.decode("utf-8")),
                consumer_timeout_ms=5_000,  # poll timeout; loop continues after
                session_timeout_ms=60_000,
                heartbeat_interval_ms=20_000,
                max_poll_interval_ms=300_000,  # 5 min; training is offloaded so poll returns fast
            )
            logger.info(
                "Kafka consumer connected to %s, topic=%s, group=%s",
                brokers, topic, group_id,
            )
            return consumer
        except (NoBrokersAvailable, KafkaError, socket.gaierror, OSError) as exc:
            logger.warning(
                "Kafka not available (attempt %d/%d, error=%s), retrying in %ds…",
                attempt, _MAX_RETRIES, exc, _RETRY_INTERVAL_S,
            )
            time.sleep(_RETRY_INTERVAL_S)

    raise RuntimeError(f"Could not connect to Kafka brokers {brokers} after {_MAX_RETRIES} attempts")


def _run_training_job(req: TrainRequest) -> None:
    """Execute training and log results. Runs in a worker thread."""
    try:
        results = run_training(req)
        for r in results:
            if r.status == "completed":
                logger.info(
                    "Auto-training completed: model=%s v%s  VaR=%.6f  CVaR=%.6f",
                    r.model_name, r.model_version, r.var, r.cvar,
                )
            else:
                logger.error(
                    "Auto-training failed: model=%s  error=%s",
                    r.model_name, r.error,
                )
    except Exception as exc:
        logger.exception("Unhandled error during auto-training: %s", exc)


def _handle_market_data_ingested(event: dict, executor: ThreadPoolExecutor) -> None:
    """Parse event and submit a training job to the executor (non-blocking)."""
    data_type = event.get("data_type", "market_price")
    if data_type != "market_price":
        logger.debug("Skipping non-market_price event (data_type=%s)", data_type)
        return

    symbols: list[str] = event.get("symbols", [])
    if not symbols:
        logger.warning("market.data.ingested event has no symbols, skipping")
        return

    cfg = get_settings()
    req = TrainRequest(
        symbols=symbols,
        model_type="all",
        alpha=cfg.default_alpha,
        horizon_days=cfg.default_horizon_days,
        lookback_days=cfg.default_lookback_days,
        n_simulations=cfg.monte_carlo_simulations,
    )

    logger.info(
        "Received market.data.ingested for symbols=%s — submitting training job",
        symbols,
    )
    executor.submit(_run_training_job, req)


def _consumer_loop(stop_event: threading.Event) -> None:
    """Main consumer loop. Runs until stop_event is set."""
    cfg = get_settings()
    brokers = [b.strip() for b in cfg.kafka_brokers.split(",")]

    try:
        consumer = _build_consumer(
            brokers=brokers,
            group_id=cfg.kafka_consumer_group,
            topic=cfg.kafka_topic_market_data,
        )
    except RuntimeError as exc:
        logger.error("Kafka consumer startup failed: %s — auto-training disabled", exc)
        return

    logger.info("Kafka consumer loop started")
    with ThreadPoolExecutor(max_workers=_TRAINING_WORKERS, thread_name_prefix="trainer") as executor:
        try:
            while not stop_event.is_set():
                try:
                    # poll() returns a dict of TopicPartition → list[ConsumerRecord]
                    records = consumer.poll(timeout_ms=5_000)
                    for _tp, messages in records.items():
                        for msg in messages:
                            try:
                                _handle_market_data_ingested(msg.value, executor)
                            except Exception as exc:
                                logger.exception(
                                    "Error handling Kafka message offset=%d: %s",
                                    msg.offset, exc,
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
