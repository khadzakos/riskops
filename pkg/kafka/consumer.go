package kafka

import (
	"context"
	"errors"

	"github.com/segmentio/kafka-go"
)

type MessageHandler func(ctx context.Context, msg kafka.Message) error

type Consumer struct {
	r *kafka.Reader
}

func NewConsumer(brokers []string, groupID, topic string) *Consumer {
	if len(brokers) == 0 || groupID == "" || topic == "" {
		return nil
	}
	return &Consumer{
		r: kafka.NewReader(kafka.ReaderConfig{
			Brokers: brokers,
			GroupID: groupID,
			Topic:   topic,
		}),
	}
}

func (c *Consumer) Consume(ctx context.Context, h MessageHandler) error {
	if c == nil || c.r == nil || h == nil {
		return nil
	}
	for {
		m, err := c.r.ReadMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			return err
		}
		if err := h(ctx, m); err != nil {
			return err
		}
	}
}

func (c *Consumer) Close() error {
	if c == nil || c.r == nil {
		return nil
	}
	return c.r.Close()
}
