FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY pkg/ pkg/
COPY apps/market-data-service/ apps/market-data-service/

RUN CGO_ENABLED=0 go build -o /bin/market-data-service ./apps/market-data-service

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/market-data-service /bin/market-data-service
ENTRYPOINT ["/bin/market-data-service"]
