"""
AI Content Shield — FastAPI Model Microservice
================================================
Template for hosting self-hosted HuggingFace / PyTorch models
for AI-generated content detection.

Endpoints:
  POST /infer/text   — text AI detection
  POST /infer/image  — image AI detection
  GET  /health       — service status

For hackathon MVP: returns dummy scores.
For production: load real models via model_loader.py.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import time
import hashlib

# ── Import model loader (uncomment when real models are ready) ──
# from model_loader import TextDetector, ImageDetector

app = FastAPI(
    title="AI Content Shield — Model Service",
    version="0.1.0",
    description="Self-hosted AI content detection using HuggingFace/PyTorch models",
)

# ── CORS (allow backend gateway) ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Request/Response models ──

class TextRequest(BaseModel):
    text: str

class ImageRequest(BaseModel):
    image: str  # base64 data URI

class DetectionResponse(BaseModel):
    score: float  # 0.0 – 1.0 probability of AI-generated
    provider: str
    details: Optional[dict] = None
    latency_ms: int


# ── Model instances (initialized on startup) ──
# Uncomment these when real models are ready:
# text_detector: TextDetector = None
# image_detector: ImageDetector = None


@app.on_event("startup")
async def startup():
    """Load models on server startup."""
    # TODO: Uncomment when real models are deployed
    # global text_detector, image_detector
    # text_detector = TextDetector()
    # image_detector = ImageDetector()
    print("🧠 Model service started (using dummy scores for MVP)")


# ──────────────────────────────────────────────────────────
# Text Detection
# ──────────────────────────────────────────────────────────

@app.post("/infer/text", response_model=DetectionResponse)
async def infer_text(req: TextRequest):
    """
    Analyze text for AI-generated content.
    
    MVP: Returns a deterministic dummy score based on text hash.
    Production: Use text_detector.predict(req.text)
    """
    start = time.time()
    
    if not req.text or len(req.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Text too short for analysis")
    
    # ── Dummy scoring for MVP ──
    # Replace with: score = text_detector.predict(req.text)
    text_hash = int(hashlib.md5(req.text.encode()).hexdigest()[:8], 16)
    score = (text_hash % 80 + 10) / 100  # 0.10 – 0.90
    
    latency_ms = int((time.time() - start) * 1000)
    
    return DetectionResponse(
        score=score,
        provider="python-model",
        details={
            "model": "dummy-mvp",
            "text_length": len(req.text),
            "note": "Replace with real model for production",
        },
        latency_ms=latency_ms,
    )


# ──────────────────────────────────────────────────────────
# Image Detection
# ──────────────────────────────────────────────────────────

@app.post("/infer/image", response_model=DetectionResponse)
async def infer_image(req: ImageRequest):
    """
    Analyze an image for AI-generated content.
    
    MVP: Returns a random dummy score.
    Production: Use image_detector.predict(req.image)
    """
    start = time.time()
    
    if not req.image:
        raise HTTPException(status_code=400, detail="No image provided")
    
    # ── Dummy scoring for MVP ──
    # Replace with: score = image_detector.predict(req.image)
    img_hash = int(hashlib.md5(req.image[:200].encode()).hexdigest()[:8], 16)
    score = (img_hash % 70 + 15) / 100  # 0.15 – 0.85
    
    latency_ms = int((time.time() - start) * 1000)
    
    return DetectionResponse(
        score=score,
        provider="python-model",
        details={
            "model": "dummy-mvp",
            "note": "Replace with real model for production",
        },
        latency_ms=latency_ms,
    )


# ──────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "model-service",
        "models_loaded": False,  # Set to True when real models are loaded
        "note": "MVP mode — using dummy scores",
    }


# ── Run with: uvicorn app:app --host 0.0.0.0 --port 8000 --reload ──
