# Wind yield — public demo

Static site (no build). Serve this folder as the web root.

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory .
# http://127.0.0.1:8765/
```

Do not open `index.html` as `file://` — JSON fetches need HTTP.

Contains precomputed map/KPI JSON only. No API keys. Restricted tower series (e.g. FINO) are not included.
