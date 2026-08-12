import asyncio
import json
import logging

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from app.config import settings

logger = logging.getLogger(__name__)

_producer: AIOKafkaProducer | None = None


async def start_producer() -> None:
    global _producer
    _producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        acks="all",
        enable_idempotence=True,
        linger_ms=5,
    )
    await _producer.start()
    logger.info("kafka producer started")


async def stop_producer() -> None:
    if _producer is not None:
        await _producer.stop()
        logger.info("kafka producer stopped")


async def publish(topic: str, key: str, value: dict) -> None:
    if _producer is None:
        logger.warning("producer not started, dropping event topic=%s", topic)
        return
    await _producer.send_and_wait(topic, value=value, key=key.encode("utf-8"))


async def consume_forever(topic: str, group_id: str, handler) -> None:
    """Generic consumer loop. `handler(dict) -> Awaitable[None]` processes
    each decoded message. Runs until cancelled, retrying on transient errors
    so a single bad message or broker blip does not kill the worker.
    """
    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        enable_auto_commit=True,
        auto_offset_reset="latest",
    )
    await consumer.start()
    logger.info("kafka consumer started topic=%s group=%s", topic, group_id)
    try:
        async for msg in consumer:
            try:
                await handler(msg.value)
            except Exception:
                logger.exception("error handling message from %s", topic)
    except asyncio.CancelledError:
        pass
    finally:
        await consumer.stop()
        logger.info("kafka consumer stopped topic=%s", topic)
