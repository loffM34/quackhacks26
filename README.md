# 🛡️ AI Content Shield

**A Chrome extension that detects and minimizes exposure to AI-generated content.**

Passively scores web pages for AI-generated text and images using a non-intrusive floating badge with a dark-blue Liquid Glass UI. Built for hackathons — designed for production.

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Express](https://img.shields.io/badge/Express-4-000)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688)

---

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Chrome Extension   │────▶│  Node.js Gateway    │────▶│  Detection Provider │
│  (React + TS + Vite)│     │  (Express)          │     │                     │
│                     │     │  /detect/text       │     │  • GPTZero API      │
│  • Content Script   │     │  /detect/image      │     │  • Sapling API      │
│  • Service Worker   │     │  /health            │     │  • HuggingFace API  │
│  • Popup / Panel    │     │                     │     │  • Python Models    │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

## Quick Start — 10 Commands

```bash
# 1. Clone the repo (if not already done)
# 2. Install frontend dependencies
cd frontend-extension; npm install

# 3. Build the extension
npm run build

# 4. Install backend dependencies
cd ../backend; npm install

# 5. Configure environment (Windows PowerShell)
cp .env.example .env

# 6. Start the backend
npm run dev

# 7. Load extension in Chrome
#    → chrome://extensions → Enable Developer Mode → Load Unpacked → select frontend-extension/dist

# 8. (Optional) Start Python model service
cd ../model-service && pip install -r requirements.txt && uvicorn app:app --reload --port 8000

# 9. (Optional) Switch to Python models
#    In backend/.env: set DETECT_PROVIDER=python, then restart backend

# 10. Visit any webpage and see the badge!
```

## Project Structure

```
ai-content-shield/
├── frontend-extension/          # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── popup.html / sidepanel.html
│   ├── src/
│   │   ├── contentScript.ts     # DOM extraction + blur + dots
│   │   ├── background.ts       # Service worker → backend
│   │   ├── ui/
│   │   │   ├── App.tsx
│   │   │   ├── FloatingBadge.tsx
│   │   │   ├── SidePanel.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── styles.css       # Liquid Glass design system
│   │   ├── utils/
│   │   │   ├── domExtractor.ts
│   │   │   ├── imageCompressor.ts
│   │   │   └── api.ts
│   │   └── types/index.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── backend/                     # Node.js Express Gateway
│   ├── src/
│   │   ├── index.js             # Server entry
│   │   ├── config.js
│   │   ├── routes/detect.js     # /detect/text, /detect/image
│   │   ├── routes/health.js
│   │   ├── services/detectService.js  # Adapter pattern
│   │   ├── providers/
│   │   │   ├── apiProvider.js   # GPTZero / Sapling / HF / Originality
│   │   │   └── pythonProvider.js
│   │   └── utils/cache.js, metrics.js
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
│
├── model-service/               # Python FastAPI (future)
│   ├── app.py                   # /infer/text, /infer/image
│   ├── model_loader.py          # HuggingFace / PyTorch loader
│   ├── requirements.txt
│   └── Dockerfile
│
├── .github/workflows/ci.yml    # CI pipeline
├── infra/deploy-backend.sh     # Deploy script
├── docs/
│   ├── demo-script.md          # 5-min judge demo
│   └── privacy-ethics.md       # Legal & ethical notes
└── README.md
```

## Switching Providers

The backend uses an **adapter pattern** — swap detection providers without any frontend changes:

| `DETECT_PROVIDER` | `API_PROVIDER_NAME` | Description                             |
| ----------------- | ------------------- | --------------------------------------- |
| `api`             | `gptzero`           | GPTZero API (recommended for hackathon) |
| `api`             | `sapling`           | Sapling AI Detector                     |
| `api`             | `huggingface`       | HuggingFace Inference API (free tier)   |
| `api`             | `originality`       | Originality.ai                          |
| `python`          | —                   | Local FastAPI model service             |

```bash
# In backend/.env:
DETECT_PROVIDER=api
API_PROVIDER_NAME=gptzero
GPTZERO_API_KEY=your-key-here

# To switch to self-hosted models:
DETECT_PROVIDER=python
MODEL_SERVICE_URL=http://localhost:8000
```

## Security

- ✅ API keys stored **only** in backend environment variables
- ✅ CORS restricted to Chrome extension origins
- ✅ Helmet security headers
- ✅ Rate limiting (30 req/min default)
- ✅ No raw content logged (only hashes + scores)
- ✅ HTTPS required for production

## License

MIT
