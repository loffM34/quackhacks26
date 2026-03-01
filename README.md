# Flare

Michael Dox, Michael Loff, Sarah Simbulan, Leonard Weber

**A Chrome extension that detects AI-generated text and images on any webpage.**

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Express](https://img.shields.io/badge/Express-4-000)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688)

---

## The Problem

For over 50,000 years, humans were the only source of art, information, language, and thought - until AI. Since it hit the mainstream, LLM's and other AI now contribute more to social media than humans do. It is growingly increasingly difficult to differentiate between ideas thought of by humans and those created by AI. Flare seeks to remedy this problem by serving as a live AI detector as you surf the web.

## What Flare Does

Flare runs directly in your browser as a Chrome extension. It **passively analyzes every page you visit**, scoring text blocks and images for AI-generation probability. A small floating badge shows the overall score at a glance. For deeper inspection, a side panel breaks down every detected block with individual scores, confidence tiers, and explanations. Flagged content can be automatically blurred until you choose to reveal it.

It's designed to be **non-intrusive** — you install it once and it works silently in the background. No copy-pasting, no switching tabs, no manual effort.

## Built With

- **Frontend**: TypeScript, React 18, Vite, Tailwind CSS, Chrome Manifest V3 APIs
- **Backend Gateway**: Node.js, Express 4, Helmet, LRU Cache
- **Model Service**: Python, FastAPI, PyTorch, HuggingFace Transformers
- **ML Model**: DistilBERT fine-tuned on HC3 dataset (ChatGPT vs human answers), trained in Google Colab
- **CI/CD**: GitHub Actions, Docker, Render

---

## How It Works

1. The **content script** extracts text blocks and images from the current page
2. Extractions are sent to the **background service worker**, which calls the **Node.js gateway**
3. The gateway forwards requests to the **Python model service** (or an external API provider)
4. Scores flow back to the extension — the badge updates, the side panel populates, and flagged content can be blurred

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  Chrome Extension    │────▶│  Node.js Gateway     │────▶│  Python Model Service│
│  (React + TS + Vite) │     │  (Express, port 3001)│     │  (FastAPI, port 8000)│
│                      │     │                      │     │                      │
│  Content Script      │     │  /detect/text/spans  │     │  /infer/text/spans   │
│  Background SW       │     │  /detect/image/batch │     │  /infer/image/batch  │
│  Side Panel + Popup  │     │  /detect/page        │     │  /infer/page         │
│  Floating Badge      │     │  /health             │     │  /health             │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

---

## Features

### Content Detection
- **Block-level text analysis** — extracts readable blocks (paragraphs, list items, headings, etc.) with a 60-word minimum threshold
- **Image analysis** — compresses page images to 512px JPEG and scores them for synthetic patterns
- **Viewport-first extraction** — prioritizes visible content with an 800px buffer above and below
- **Per-block scoring** — each text block and image gets an individual AI probability score (0–100%)

### Platform-Specific Extractors
The content script has dedicated extraction logic for:
- **Twitter / X** — buffers individual tweets into 150-word chunks before analysis
- **Google Docs** — reads from `.kix-paragraphrenderer` elements
- **Wikipedia** — targets `#mw-content-text .mw-parser-output > p`
- **LinkedIn, Facebook, Instagram, Reddit** — platform-specific post selectors

### SPA Navigation Support
- Hooks `history.pushState` and `replaceState` for client-side routing
- Watches `popstate` events (back/forward navigation)
- `MutationObserver` detects new content (infinite scroll, dynamic loading)
- Debounced rescans (1200ms for content changes, 800ms for navigation)

### UI
- **Floating badge** — fixed bottom-right corner indicator, color-coded green/yellow/red by score
- **Side panel** — detailed breakdown with page score, text/image scores, AI density, and per-item drill-down
- **Click-to-highlight** — click any item in the side panel to scroll to and highlight it on the page
- **Auto-blur** — optionally blur text blocks above a configurable threshold; click to reveal
- **Elder Mode** — larger fonts and simplified interface
- **Threshold slider** — adjust the AI score cutoff (0–100%) for blur and flagging

### Backend
- **Adapter pattern** — swap detection providers without touching the frontend
- **LRU cache** with configurable TTL (default 10 minutes, 500 entries)
- **Rate limiting** at 30 requests/minute
- **Helmet security headers** and CORS restrictions

### Model Service
- **DistilBERT text classifier** trained on HC3 (ChatGPT vs human answers)
- **Temperature-calibrated** confidence scores via `training_config.json`
- **Fallback model** — auto-downloads `roberta-base-openai-detector` from HuggingFace if no local weights are found
- **Optional Featherless explanations** — LLM-generated "why flagged" text via configurable API
- **Image detector stub** — returns neutral 0.5 (ready for a real image model)

---

## Quick Start

### 1. Frontend Extension

```bash
cd frontend-extension
npm install
npm run build
```

Load in Chrome: `chrome://extensions` → Enable Developer Mode → Load Unpacked → select `frontend-extension/dist`

### 2. Node.js Backend

```bash
cd backend
npm install
cp .env.example .env    # then edit .env with your settings
npm run dev             # starts on port 3001
```

### 3. Python Model Service

```bash
cd model-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

On first run without local model weights, it auto-downloads `roberta-base-openai-detector` from HuggingFace.

### 4. (Optional) Train Your Own Model

Open `model-service/ColabTextModelFast.ipynb` in Google Colab, run all cells (~30–45 min on T4 GPU), download the zip, and extract into `model-service/model/`.

---

## Project Structure

```
quackhacks26/
├── frontend-extension/             # Chrome Extension (MV3)
│   ├── public/
│   │   ├── manifest.json
│   │   └── assets/                 # Extension icons (16/48/128px)
│   ├── src/
│   │   ├── contentScript.ts        # DOM extraction, blur, badge, SPA hooks
│   │   ├── background.ts           # Service worker — caching, backend calls
│   │   ├── types/index.ts          # Shared TypeScript types
│   │   ├── ui/
│   │   │   ├── App.tsx             # Main popup component
│   │   │   ├── FloatingBadge.tsx   # Floating score badge
│   │   │   ├── SidePanel.tsx       # Detailed analysis panel
│   │   │   ├── Settings.tsx        # User preferences
│   │   │   ├── popup-entry.tsx     # Popup React mount
│   │   │   ├── sidepanel-entry.tsx  # Side panel React mount
│   │   │   └── styles.css          # Liquid Glass design system
│   │   └── utils/
│   │       ├── api.ts              # Extension ↔ background messaging
│   │       ├── domExtractor.ts     # DOM traversal helpers
│   │       └── imageCompressor.ts  # Canvas-based image compression
│   ├── popup.html
│   ├── sidepanel.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                        # Node.js Express Gateway
│   ├── src/
│   │   ├── index.js                # Server entry (port 3001)
│   │   ├── config.js               # Environment config
│   │   ├── routes/
│   │   │   ├── detect.js           # /detect/text, /detect/text/spans, etc.
│   │   │   └── health.js           # /health
│   │   ├── services/
│   │   │   └── detectService.js    # Provider adapter
│   │   ├── providers/
│   │   │   ├── apiProvider.js      # GPTZero / Sapling / HuggingFace / Originality
│   │   │   ├── pythonProvider.js   # Local model service proxy
│   │   │   └── hiveImageProvider.js # NVIDIA NIM image detection
│   │   └── utils/
│   │       ├── cache.js            # LRU cache
│   │       └── metrics.js          # Request metrics
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
│
├── model-service/                  # Python FastAPI Model Service
│   ├── app.py                      # /infer/text, /infer/text/spans, /infer/page, etc.
│   ├── model_loader.py             # TextDetector + ImageDetector classes
│   ├── explanation_client.py       # Featherless LLM explanations
│   ├── test_model.py               # Smoke tests
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── ColabTextModel.ipynb        # Full training notebook (RoBERTa, ~3h)
│   └── ColabTextModelFast.ipynb    # Fast training notebook (DistilBERT, ~30min)
│
├── docs/
│   ├── demo-script.md              # 5-minute judge demo walkthrough
│   └── privacy-ethics.md           # Privacy policy and ethical guidelines
│
├── infra/
│   └── deploy-backend.sh           # Render / Railway / Docker deploy
│
├── .github/workflows/ci.yml       # CI: lint, build, test, deploy
└── README.md
```

---

## API Endpoints

### Node.js Gateway (port 3001)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service status |
| `POST` | `/detect/text` | Single text detection |
| `POST` | `/detect/text/spans` | Batch text chunks with per-block scores |
| `POST` | `/detect/image` | Single image detection |
| `POST` | `/detect/image/batch` | Batch image detection |
| `POST` | `/detect/page` | Full page analysis (text + images) |

### Python Model Service (port 8000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Model status, loaded models, config |
| `POST` | `/infer/text` | Single text → AI probability (0–1) |
| `POST` | `/infer/text/spans` | Batch text chunks with explanations |
| `POST` | `/infer/image` | Single image → AI probability (0–1) |
| `POST` | `/infer/image/batch` | Batch images with explanations |
| `POST` | `/infer/page` | Combined text + image analysis |

---

## Detection Providers

The backend uses an adapter pattern — swap providers by changing environment variables:

| `DETECT_PROVIDER` | `API_PROVIDER_NAME` | Description |
|-------------------|---------------------|-------------|
| `python` | — | Local DistilBERT model service (default) |
| `api` | `gptzero` | GPTZero API |
| `api` | `sapling` | Sapling AI Detector |
| `api` | `huggingface` | HuggingFace Inference API |
| `api` | `originality` | Originality.ai |

Image detection uses NVIDIA NIM (Hive) when `NVIDIA_API_KEY` is set.

```bash
# backend/.env — self-hosted (default)
DETECT_PROVIDER=python
MODEL_SERVICE_URL=http://localhost:8000

# backend/.env — external API
DETECT_PROVIDER=api
API_PROVIDER_NAME=gptzero
GPTZERO_API_KEY=your-key-here
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Gateway port |
| `DETECT_PROVIDER` | `api` | `api` or `python` |
| `API_PROVIDER_NAME` | `gptzero` | Which API to use |
| `GPTZERO_API_KEY` | — | GPTZero key |
| `SAPLING_API_KEY` | — | Sapling key |
| `HUGGINGFACE_API_KEY` | — | HuggingFace key |
| `ORIGINALITY_API_KEY` | — | Originality.ai key |
| `NVIDIA_API_KEY` | — | NVIDIA NIM key (image detection) |
| `MODEL_SERVICE_URL` | `http://localhost:8000` | Python service URL |
| `CACHE_TTL_MS` | `600000` | Cache lifetime (10 min) |
| `CACHE_MAX_SIZE` | `500` | Max cached entries |
| `RATE_LIMIT_PER_MINUTE` | `30` | Rate limit |

### Model Service (optional env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_FEATHERLESS_EXPLANATIONS` | `false` | Enable LLM explanations |
| `FEATHERLESS_API_KEY` | — | API key for explanations |
| `FEATHERLESS_MODEL` | `google/gemma-3-27b-it` | Explanation model |
| `FEATHERLESS_BASE_URL` | `https://api.featherless.ai/v1` | Explanation endpoint |

---

## Training a Custom Model

Two Colab notebooks are included in `model-service/`:

| Notebook | Model | Dataset | Time |
|----------|-------|---------|------|
| `ColabTextModelFast.ipynb` | DistilBERT (67M params) | ~48K HC3, balanced | ~30–45 min on T4 |
| `ColabTextModel.ipynb` | RoBERTa-base (125M params) | ~385K HC3 + RAID | ~3h on A100 |

After training, download the zip and extract into `model-service/model/`. The `model_loader.py` automatically picks up the weights and calibrated temperature.

---

## Deployment

### Docker

```bash
# Backend
cd backend
docker build -t ai-shield-backend .
docker run -p 3001:3001 --env-file .env ai-shield-backend

# Model Service
cd model-service
docker build -t ai-shield-model .
docker run -p 8000:8000 ai-shield-model
```

### Cloud

The `infra/deploy-backend.sh` script supports Render, Railway, and Docker deployment. CI is configured via `.github/workflows/ci.yml` with optional auto-deploy to Render on push to `main`.

---

## Security

- API keys stored only in backend environment variables — never sent to the extension
- CORS restricted to extension and localhost origins
- Helmet security headers on all responses
- Rate limiting (30 req/min default)
- No raw content logged (hashes + scores only)
- Content sent to backend for analysis — see `docs/privacy-ethics.md` for full policy

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | React 18, TypeScript, Vite, Tailwind CSS |
| Background | Chrome MV3 Service Worker |
| Gateway | Express 4, Helmet, LRU Cache |
| Model Service | FastAPI, PyTorch, HuggingFace Transformers |
| CI/CD | GitHub Actions, Render |

---

## License

MIT
