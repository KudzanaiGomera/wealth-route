# wealth-route

Single-file personal finance app (`index.html`) that tracks income, debt, assets, and net worth, then recommends what to do next with clear reasons.

## Run

Serve the repository root over HTTP, then open `index.html` in any modern browser (for example: `python3 -m http.server` and browse to `http://localhost:8000/index.html`).

The app saves your latest values in browser `localStorage` (`wealth-route-state-v1`). Persistence is most reliable when accessed over `http://localhost` (browser `file://` behavior can vary). To reset, clear site data/local storage in your browser.
