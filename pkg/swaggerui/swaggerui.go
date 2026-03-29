package swaggerui

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

// Register mounts the OpenAPI YAML and Swagger UI at /api/{service}/openapi.yaml and /api/{service}/docs.
// The spec is embedded in the docs page as JSON so the browser does not need a second fetch (avoids proxy/CORS/CDN issues).
func Register(r chi.Router, service string, specBytes []byte) error {
	specJSON, err := specYAMLToJSON(specBytes)
	if err != nil {
		return fmt.Errorf("swagger spec: %w", err)
	}

	base := "/api/" + service

	r.Get(base+"/openapi.yaml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write(specBytes)
	})

	html := swaggerPageHTML(service, specJSON)
	r.Get(base+"/docs", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(html))
	})
	return nil
}

func specYAMLToJSON(specBytes []byte) ([]byte, error) {
	var doc any
	if err := yaml.Unmarshal(specBytes, &doc); err != nil {
		return nil, err
	}
	return json.Marshal(doc)
}

func swaggerPageHTML(service string, specJSON []byte) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>%s — API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      spec: %s,
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      validatorUrl: null,
    });
  </script>
</body>
</html>`, service, specJSON)
}
