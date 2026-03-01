# ♻️ RecycleRun
### Recycle Smarter. Earn More.
**Hack for Humanity 2026 · Santa Clara University · Feb 28 – Mar 1**

---

## Team

| Developer | Role | Owns |
|-----------|------|------|
| **Anisha** | UI/UX Lead | `frontend/src/` — all pages, components, styles |
| **Soham** | Backend Lead | `backend/services/` — optimizer, vision AI, voice, database |
| **Paarth** | Backend | `backend/models/` + `backend/tests/` — data models, unit tests |
| **Atharva** | API Layer | `backend/routes/` + `backend/utils/` — Flask routes, helpers |
| **Sara** | Frontend Logic | `frontend/src/services/` + `hooks/` + `utils/` — API layer, state hooks, client optimizer |

---

## Sponsor Tech Stack

| Sponsor | Integration | File |
|---------|------------|------|
| **AMD Developer Cloud** | Vision AI — photo → material classification | `backend/services/vision.py` |
| **ElevenLabs** | Voice calls to households when driver accepts | `backend/services/voice.py` |
| **Google Maps** | Route display + navigation | `frontend/src/pages/DriverPage.jsx` |
| (Optional) **Anthropic Claude** | Vision fallback (disabled by default) | `backend/services/vision.py` |

---

## Quick Start (No API keys needed)

```bash
# Terminal 1 — Backend
cd recyclerun-team
pip install -r backend/requirements.txt
python -m flask --app backend.app:create_app run --host 0.0.0.0 --port 5050
# → http://localhost:5050

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
# → http://localhost:5173

# Terminal 3 — Mobile (Expo Go)
cd mobile
npm install
../scripts/mobile/start-expo-lan.sh
# Scan QR in Expo Go
```

For full sponsor integrations, copy `.env.example` to `.env` and add keys.

---

## Architecture

```
Browser (React)
    │
    ├── pages/    ← Anisha: one file per screen, zero page-level conflicts
    ├── components/
    │     ├── ui/          ← shared atoms (Button, Card, Tag, Toast)
    │     ├── household/   ← PhotoUpload, ManualMaterials
    │     └── driver/      ← RouteBanner, StopCard, TruckMeter
    ├── services/  ← Sara: api.js (all fetch calls), demoData.js
    ├── hooks/     ← Sara: useListings, useRoute
    └── utils/     ← Sara: optimizer.js (client-side route fallback)
         │
         │ HTTP (localhost:5050)
         ▼
Flask Backend
    │
    ├── routes/    ← Atharva: listings, classify, optimize, impact
    ├── services/  ← Soham:  optimizer, vision, voice, database
    └── models/    ← Paarth: Listing, Route, Material
```

---

## API Reference

| Method | Endpoint | Owner | Description |
|--------|---------|-------|-------------|
| GET | `/api/listings` | Atharva | All available listings |
| POST | `/api/listings` | Atharva | Create new listing |
| POST | `/api/listings/reset-demo` | Atharva | Reset all listings for demo |
| POST | `/api/classify` | Atharva | AMD vision classification |
| POST | `/api/optimize-route` | Atharva | Build optimized driver route (supports `objective: "value"` or `"lbs"`) |
| POST | `/api/accept-route` | Atharva | Accept + trigger ElevenLabs calls |
| GET | `/api/impact` | Atharva | Community stats |
| GET | `/api/materials` | Atharva | Material rates |
| GET | `/api/health` | Atharva | Health check |

---

## How to Run Tests

```bash
cd backend
pytest tests/ -v
```

---

## Git Branches

See `docs/GIT_WORKFLOW.md` for the full branching strategy.

```
main     ← demo-ready, protected
  └── dev  ← integration
        ├── feat/anisha/*
        ├── feat/soham/*
        ├── feat/paarth/*
        ├── feat/atharva/*
        └── feat/sara/*
```
