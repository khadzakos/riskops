FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY pkg/ pkg/
COPY apps/portfolio-service/ apps/portfolio-service/

RUN CGO_ENABLED=0 go build -o /bin/portfolio-service ./apps/portfolio-service

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/portfolio-service /bin/portfolio-service
ENTRYPOINT ["/bin/portfolio-service"]
