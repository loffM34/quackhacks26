"""
AI Content Shield — FastAPI Model Microservice
================================================
Serves the fine-tuned DistilBERT classifier for AI text detection.

Endpoints:
  POST /infer/text   — text AI detection
  POST /infer/image  — not supported, returns neutral score
  GET  /health       — service status

Run:
  uvicorn app:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from model_loader import TextDetector

# ── App ──

app = FastAPI(
    title="AI Content Shield — Model Service",
    version="2.0.0",
    description="AI text detection using a fine-tuned DistilBERT model (HC3 + RAID)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Request/Response schemas ──

class TextRequest(BaseModel):
    text: str

class ImageRequest(BaseModel):
    image: str  # base64 data URI

class DetectionResponse(BaseModel):
    score: float          # 0.0 – 1.0 probability of AI-generated
    provider: str
    details: Optional[dict] = None
    latency_ms: int


# ── Startup: load model once so first request is fast ──

detector = None

@app.on_event("startup")
async def startup() -> None:
    global detector
    try:
        detector = TextDetector()
        # Warm up so the first real request isn't slow
        detector.predict("warmup")
        print("Model loaded and ready.")
    except Exception as e:
        print(f"Model failed to load: {e}")
        print("Make sure model files are in model-service/model/")


# ── Text Detection ──

@app.post("/infer/text", response_model=DetectionResponse)
async def infer_text(req: TextRequest) -> DetectionResponse:
    """
    Analyze text for AI-generated content.
    Returns a score from 0.0 (human) to 1.0 (AI).
    """
    if not req.text or len(req.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Text too short for analysis")

    if detector is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Check model-service/model/ directory.")

    start = time.time()

    try:
        result = detector.predict(req.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scoring error: {e}")

    latency_ms = int((time.time() - start) * 1000)

    return DetectionResponse(
        score=result["ai_prob"],
        provider="distilbert-hc3-raid",
        details={
            "human_prob": result["human_prob"],
            "prediction": result["pred"],
            "text_length": len(req.text),
        },
        latency_ms=latency_ms,
    )


# ── Image Detection (not supported) ──

@app.post("/infer/image", response_model=DetectionResponse)
async def infer_image(req: ImageRequest) -> DetectionResponse:
    if not req.image:
        raise HTTPException(status_code=400, detail="No image provided")

    return DetectionResponse(
        score=0.5,
        provider="distilbert-hc3-raid",
        details={"note": "Image detection not supported — text-only model"},
        latency_ms=0,
    )


# ── Health ──

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "model-service",
        "model": "distilbert-hc3-raid",
        "model_loaded": detector is not None,
    }
