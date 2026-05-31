package api

import (
	"crypto/subtle"
	"net/http"
)

func InternalTokenMiddleware(token string) func(http.Handler) http.Handler {
	tokenBytes := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := r.Header.Get("X-Internal-Token")
			// Constant-time comparison to prevent timing attacks.
			if subtle.ConstantTimeCompare([]byte(provided), tokenBytes) != 1 {
				http.Error(w,
					`{"error":{"code":"UNAUTHORIZED","message":"Invalid internal token"}}`,
					http.StatusUnauthorized,
				)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
