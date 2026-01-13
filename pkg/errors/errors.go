package errors

import (
	"fmt"
	"net/http"
)

// Error represents an application error
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"-"`
	Err     error  `json:"-"`
}

// Error implements error interface
func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

// Unwrap returns the underlying error
func (e *Error) Unwrap() error {
	return e.Err
}

// New creates a new error
func New(code, message string, status int) *Error {
	return &Error{
		Code:    code,
		Message: message,
		Status:  status,
	}
}

// Wrap wraps an existing error
func Wrap(err error, code, message string, status int) *Error {
	return &Error{
		Code:    code,
		Message: message,
		Status:  status,
		Err:     err,
	}
}

// Predefined errors
var (
	ErrNotFound     = New("NOT_FOUND", "Resource not found", http.StatusNotFound)
	ErrBadRequest   = New("BAD_REQUEST", "Invalid request", http.StatusBadRequest)
	ErrUnauthorized = New("UNAUTHORIZED", "Unauthorized", http.StatusUnauthorized)
	ErrForbidden    = New("FORBIDDEN", "Forbidden", http.StatusForbidden)
	ErrInternal     = New("INTERNAL_ERROR", "Internal server error", http.StatusInternalServerError)
)

// IsNotFound checks if error is not found
func IsNotFound(err error) bool {
	if e, ok := err.(*Error); ok {
		return e.Status == http.StatusNotFound
	}
	return false
}

// IsBadRequest checks if error is bad request
func IsBadRequest(err error) bool {
	if e, ok := err.(*Error); ok {
		return e.Status == http.StatusBadRequest
	}
	return false
}
