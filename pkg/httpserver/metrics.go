package httpserver

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

func init() {
	prometheus.MustRegister(collectors.NewBuildInfoCollector())
}
