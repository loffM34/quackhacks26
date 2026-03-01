"""
AI Content Shield — FastAPI Model Microservice
================================================
Production-oriented version with:
- real text/image model loading
- text chunk + image batch scoring
- optional Featherless/Gemma explanations for medium/high flags
- page-level aggregation
"""

from __future__ import annotations

import os
import statistics
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from model_loader import ImageDetector, TextDetector

try:
    from explanation_client import FeatherlessExplainer
except Exception:  # pragma: no cover
    FeatherlessExplainer = None


app = FastAPI(
    title="AI Content Shield — Model Service",
    version="0.2.0",
    description="Self-hosted AI content detection using HuggingFace/PyTorch models",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class TextRequest(BaseModel):
    text: str = Field(..., min_length=10)


class ImageRequest(BaseModel):
    image: str  # base64 data URI


class TextChunk(BaseModel):
    id: str
    text: str = Field(..., min_length=3)
    kind: str = "sentence"
    start_char: Optional[int] = None
    end_char: Optional[int] = None


class TextSpanRequest(BaseModel):
    chunks: List[TextChunk]


class ImageItem(BaseModel):
    id: str
    image: str  # base64 data URI


class ImageBatchRequest(BaseModel):
    images: List[ImageItem]


class PageRequest(BaseModel):
    chunks: List[TextChunk] = Field(default_factory=list)
    images: List[ImageItem] = Field(default_factory=list)


class DetectionResponse(BaseModel):
    score: float
    provider: str
    details: Optional[dict] = None
    latency_ms: int


# ---------------------------------------------------------------------------
# Globals (loaded on startup)
# ---------------------------------------------------------------------------
text_detector: Optional[TextDetector] = None
image_detector: Optional[ImageDetector] = None
explainer: Optional[Any] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clamp_score(score: float) -> float:
    return max(0.0, min(1.0, float(score)))


def tier_from_score(score: float) -> str:
    if score >= 0.80:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


def explanation_fallback(kind: str, tier: str) -> Optional[str]:
    if tier == "low":
        return None
    if kind == "text":
        return (
            "Moderate AI-like writing signal detected."
            if tier == "medium"
            else "Strong AI-like writing signal detected due to highly uniform or templated phrasing."
        )
    return (
        "Moderate synthetic-image signal detected."
        if tier == "medium"
        else "Strong synthetic-image signal detected based on the classifier's visual pattern match."
    )


def maybe_explain_text(text: str, score: float, tier: str) -> Optional[str]:
    if tier == "low":
        return None
    if explainer is None:
        return explanation_fallback("text", tier)
    try:
        return explainer.explain_text_chunk(text=text, score=score, tier=tier)
    except Exception:
        return explanation_fallback("text", tier)


def maybe_explain_image(image_data: str, score: float, tier: str) -> Optional[str]:
    if tier == "low":
        return None
    if explainer is None:
        return explanation_fallback("image", tier)
    try:
        return explainer.explain_image(image_data_uri=image_data, score=score, tier=tier)
    except Exception:
        return explanation_fallback("image", tier)


def summarize_overall(text_scores: List[float], image_scores: List[float]) -> float:
    """Weighted average that leans a bit more on images when present."""
    if text_scores and image_scores:
        return clamp_score(0.4 * statistics.mean(text_scores) + 0.6 * statistics.mean(image_scores))
    if image_scores:
        return clamp_score(statistics.mean(image_scores))
    if text_scores:
        return clamp_score(statistics.mean(text_scores))
    return 0.0


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup() -> None:
    global text_detector, image_detector, explainer

    text_model_name = os.getenv("TEXT_MODEL_NAME", "openai-community/roberta-base-openai-detector")
    image_model_name = os.getenv("IMAGE_MODEL_NAME", "umm-maybe/AI-image-detector")
    use_explanations = os.getenv("ENABLE_FEATHERLESS_EXPLANATIONS", "true").lower() == "true"

    text_detector = TextDetector(model_name=text_model_name)
    image_detector = ImageDetector(model_name=image_model_name)

    if use_explanations and FeatherlessExplainer is not None and os.getenv("FEATHERLESS_API_KEY"):
        explainer = FeatherlessExplainer(
            api_key=os.getenv("FEATHERLESS_API_KEY"),
            model=os.getenv("FEATHERLESS_MODEL", "google/gemma-3-27b-it"),
            base_url=os.getenv("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"),
        )
        print("✨ Featherless explanations enabled")
    else:
        explainer = None
        print("ℹ️ Featherless explanations disabled; using local fallback explanations")

    print("🧠 Model service started")


# ---------------------------------------------------------------------------
# Single-item endpoints (backward-compatible)
# ---------------------------------------------------------------------------
@app.post("/infer/text", response_model=DetectionResponse)
async def infer_text(req: TextRequest) -> DetectionResponse:
    start = time.time()
    assert text_detector is not None

    score = clamp_score(text_detector.predict(req.text))
    tier = tier_from_score(score)
    explanation = maybe_explain_text(req.text, score, tier)
    latency_ms = int((time.time() - start) * 1000)

    return DetectionResponse(
        score=score,
        provider="python-model",
        details={
            "model": getattr(text_detector, "model_name", "unknown"),
            "text_length": len(req.text),
            "tier": tier,
            "explanation": explanation,
        },
        latency_ms=latency_ms,
    )


@app.post("/infer/image", response_model=DetectionResponse)
async def infer_image(req: ImageRequest) -> DetectionResponse:
    start = time.time()
    assert image_detector is not None

    if not req.image:
        raise HTTPException(status_code=400, detail="No image provided")

    score = clamp_score(image_detector.predict(req.image))
    tier = tier_from_score(score)
    explanation = maybe_explain_image(req.image, score, tier)
    latency_ms = int((time.time() - start) * 1000)

    return DetectionResponse(
        score=score,
        provider="python-model",
        details={
            "model": getattr(image_detector, "model_name", "unknown"),
            "tier": tier,
            "explanation": explanation,
        },
        latency_ms=latency_ms,
    )


# ---------------------------------------------------------------------------
# Localized / batch endpoints for the extension
# ---------------------------------------------------------------------------
@app.post("/infer/text/spans", response_model=DetectionResponse)
async def infer_text_spans(req: TextSpanRequest) -> DetectionResponse:
    start = time.time()
    assert text_detector is not None

    if not req.chunks:
        raise HTTPException(status_code=400, detail="No text chunks provided")

    texts = [chunk.text for chunk in req.chunks]
    scores = [clamp_score(s) for s in text_detector.predict_batch(texts)]

    results: List[Dict[str, Any]] = []
    for chunk, score in zip(req.chunks, scores):
        tier = tier_from_score(score)
        results.append(
            {
                "id": chunk.id,
                "kind": chunk.kind,
                "text": chunk.text,
                "start_char": chunk.start_char,
                "end_char": chunk.end_char,
                "score": score,
                "tier": tier,
                "explanation": maybe_explain_text(chunk.text, score, tier),
            }
        )

    latency_ms = int((time.time() - start) * 1000)
    return DetectionResponse(
        score=summarize_overall(scores, []),
        provider="python-model",
        details={
            "results": results,
            "flagged_count": sum(1 for r in results if r["tier"] in {"medium", "high"}),
        },
        latency_ms=latency_ms,
    )


@app.post("/infer/image/batch", response_model=DetectionResponse)
async def infer_image_batch(req: ImageBatchRequest) -> DetectionResponse:
    start = time.time()
    assert image_detector is not None

    if not req.images:
        raise HTTPException(status_code=400, detail="No images provided")

    results: List[Dict[str, Any]] = []
    scores: List[float] = []

    for item in req.images:
        score = clamp_score(image_detector.predict(item.image))
        scores.append(score)
        tier = tier_from_score(score)
        results.append(
            {
                "id": item.id,
                "score": score,
                "tier": tier,
                "explanation": maybe_explain_image(item.image, score, tier),
            }
        )

    latency_ms = int((time.time() - start) * 1000)
    return DetectionResponse(
        score=summarize_overall([], scores),
        provider="python-model",
        details={
            "results": results,
            "flagged_count": sum(1 for r in results if r["tier"] in {"medium", "high"}),
        },
        latency_ms=latency_ms,
    )


@app.post("/infer/page", response_model=DetectionResponse)
async def infer_page(req: PageRequest) -> DetectionResponse:
    start = time.time()
    assert text_detector is not None
    assert image_detector is not None

    text_results: List[Dict[str, Any]] = []
    image_results: List[Dict[str, Any]] = []
    text_scores: List[float] = []
    image_scores: List[float] = []

    if req.chunks:
        chunk_scores = [clamp_score(s) for s in text_detector.predict_batch([c.text for c in req.chunks])]
        text_scores.extend(chunk_scores)
        for chunk, score in zip(req.chunks, chunk_scores):
            tier = tier_from_score(score)
            text_results.append(
                {
                    "id": chunk.id,
                    "kind": chunk.kind,
                    "text": chunk.text,
                    "start_char": chunk.start_char,
                    "end_char": chunk.end_char,
                    "score": score,
                    "tier": tier,
                    "explanation": maybe_explain_text(chunk.text, score, tier),
                }
            )

    if req.images:
        for item in req.images:
            score = clamp_score(image_detector.predict(item.image))
            image_scores.append(score)
            tier = tier_from_score(score)
            image_results.append(
                {
                    "id": item.id,
                    "score": score,
                    "tier": tier,
                    "explanation": maybe_explain_image(item.image, score, tier),
                }
            )

    overall_score = summarize_overall(text_scores, image_scores)
    latency_ms = int((time.time() - start) * 1000)

    return DetectionResponse(
        score=overall_score,
        provider="python-model",
        details={
            "text": {
                "score": summarize_overall(text_scores, []),
                "results": text_results,
            },
            "images": {
                "score": summarize_overall([], image_scores),
                "results": image_results,
            },
            "overall_tier": tier_from_score(overall_score),
        },
        latency_ms=latency_ms,
    )


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "model-service",
        "models_loaded": text_detector is not None and image_detector is not None,
        "explanations_enabled": explainer is not None,
        "text_model": getattr(text_detector, "model_name", None) if text_detector else None,
        "image_model": getattr(image_detector, "model_name", None) if image_detector else None,
    }