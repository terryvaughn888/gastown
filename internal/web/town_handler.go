package web

import (
	"bytes"
	"context"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"sync"
	"time"
)

// TownData represents data passed to the town template.
type TownData struct {
	Workers   []WorkerRow  `json:"workers"`
	Hooks     []HookRow    `json:"hooks"`
	Sessions  []SessionRow `json:"sessions"`
	Mayor     *MayorStatus `json:"mayor"`
	CSRFToken string       `json:"-"`
	// InitialStateJSON is the JSON-encoded initial state for the canvas.
	InitialStateJSON template.JS `json:"-"`
}

// TownHandler handles HTTP requests for the /town game visualization.
type TownHandler struct {
	fetcher      ConvoyFetcher
	template     *template.Template
	fetchTimeout time.Duration
	csrfToken    string
}

// NewTownHandler creates a new town handler.
func NewTownHandler(fetcher ConvoyFetcher, fetchTimeout time.Duration, csrfToken string) (*TownHandler, error) {
	tmpl, err := LoadTemplates()
	if err != nil {
		return nil, err
	}

	return &TownHandler{
		fetcher:      fetcher,
		template:     tmpl,
		fetchTimeout: fetchTimeout,
		csrfToken:    csrfToken,
	}, nil
}

// ServeHTTP handles GET /town requests and renders the game UI.
func (h *TownHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.fetchTimeout)
	defer cancel()

	var (
		workers  []WorkerRow
		hooks    []HookRow
		sessions []SessionRow
		mayor    *MayorStatus
		wg       sync.WaitGroup
	)

	wg.Add(4)

	go func() {
		defer wg.Done()
		var err error
		workers, err = h.fetcher.FetchWorkers()
		if err != nil {
			log.Printf("town: FetchWorkers failed: %v", err)
		}
	}()
	go func() {
		defer wg.Done()
		var err error
		hooks, err = h.fetcher.FetchHooks()
		if err != nil {
			log.Printf("town: FetchHooks failed: %v", err)
		}
	}()
	go func() {
		defer wg.Done()
		var err error
		sessions, err = h.fetcher.FetchSessions()
		if err != nil {
			log.Printf("town: FetchSessions failed: %v", err)
		}
	}()
	go func() {
		defer wg.Done()
		var err error
		mayor, err = h.fetcher.FetchMayor()
		if err != nil {
			log.Printf("town: FetchMayor failed: %v", err)
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
		log.Printf("town: fetch timeout after %v", h.fetchTimeout)
		<-done
	}

	data := TownData{
		Workers:   workers,
		Hooks:     hooks,
		Sessions:  sessions,
		Mayor:     mayor,
		CSRFToken: h.csrfToken,
	}

	// Marshal initial state as JSON for embedding in the template.
	stateJSON, err := json.Marshal(data)
	if err != nil {
		log.Printf("town: JSON marshal failed: %v", err)
		http.Error(w, "Failed to prepare town data", http.StatusInternalServerError)
		return
	}
	data.InitialStateJSON = template.JS(stateJSON)

	var buf bytes.Buffer
	if err := h.template.ExecuteTemplate(&buf, "town.html", data); err != nil {
		log.Printf("town: template execution failed: %v", err)
		http.Error(w, "Failed to render template", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := buf.WriteTo(w); err != nil {
		log.Printf("town: response write failed: %v", err)
	}
}
