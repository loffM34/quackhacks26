"""
Model Loader — AI Content Detection Models
===========================================
Updated version with:
- device placement
- safer label mapping
- text batch inference
- robust image decoding
"""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Iterable, List

import torch
from PIL import Image
from transformers import (
    AutoFeatureExtractor,
    AutoModelForImageClassification,
    AutoModelForSequenceClassification,
    AutoTokenizer,
)


def _normalize_label(label: str) -> str:
    return label.strip().lower().replace("_", " ")


def _find_ai_label_index(id2label: dict, positive_terms: Iterable[str], fallback_index: int = 1) -> int:
    if not id2label:
        return fallback_index

    normalized = {int(k): _normalize_label(v) for k, v in id2label.items()}

    # Prefer explicit positive labels.
    for idx, label in normalized.items():
        if any(term in label for term in positive_terms):
            return idx

    # If we can identify a clearly "real" label in a binary classifier, use the other index.
    if len(normalized) == 2:
        for idx, label in normalized.items():
            if any(term in label for term in ["real", "human", "natural", "authentic", "organic"]):
                other_indices = [i for i in normalized.keys() if i != idx]
                if other_indices:
                    return other_indices[0]

    return fallback_index


class TextDetector:
    """Text AI-detection model using Hugging Face Transformers."""

    def __init__(self, model_name: str = "openai-community/roberta-base-openai-detector"):
        self.model_name = model_name
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        print(f"Loading text model: {model_name} on {self.device}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.to(self.device)
        self.model.eval()

        self.ai_label_index = _find_ai_label_index(
            getattr(self.model.config, "id2label", {}),
            positive_terms=["ai", "fake", "generated", "synthetic", "machine"],
            fallback_index=1,
        )
        print(f"✅ Text model loaded: {model_name} (AI label index: {self.ai_label_index})")

    @torch.no_grad()
    def predict(self, text: str) -> float:
        return self.predict_batch([text])[0]

    @torch.no_grad()
    def predict_batch(self, texts: List[str]) -> List[float]:
        inputs = self.tokenizer(
            texts,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        outputs = self.model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        return probs[:, self.ai_label_index].detach().cpu().tolist()


class ImageDetector:
    """Image AI-detection model using Hugging Face image classification."""

    def __init__(self, model_name: str = "umm-maybe/AI-image-detector"):
        self.model_name = model_name
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        print(f"Loading image model: {model_name} on {self.device}")
        self.extractor = AutoFeatureExtractor.from_pretrained(model_name)
        self.model = AutoModelForImageClassification.from_pretrained(model_name)
        self.model.to(self.device)
        self.model.eval()

        self.ai_label_index = _find_ai_label_index(
            getattr(self.model.config, "id2label", {}),
            positive_terms=["ai", "fake", "generated", "synthetic", "artificial"],
            fallback_index=1,
        )
        print(f"✅ Image model loaded: {model_name} (AI label index: {self.ai_label_index})")

    def _decode_image(self, image_data: str) -> Image.Image:
        if not image_data:
            raise ValueError("Empty image payload")

        try:
            base64_str = image_data.split(",", 1)[-1]
            image_bytes = base64.b64decode(base64_str)
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            return image
        except Exception as exc:
            raise ValueError("Invalid base64 image data") from exc

    @torch.no_grad()
    def predict(self, image_data: str) -> float:
        image = self._decode_image(image_data)
        inputs = self.extractor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        outputs = self.model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        return probs[:, self.ai_label_index].detach().cpu().item()