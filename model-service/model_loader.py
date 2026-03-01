"""
Model Loader — AI Content Detection Models
===========================================
Loads the fine-tuned DistilBERT model trained on HC3 + RAID datasets.

Usage:
  detector = TextDetector()
  result = detector.predict("Some text to analyze")
  # result = {"ai_prob": 0.91, "human_prob": 0.09, "pred": "ai"}
"""

import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from pathlib import Path

# Path to the fine-tuned model files (relative to this file)
DEFAULT_MODEL_PATH = Path(__file__).parent / "model"

# Temperature learned from calibration on validation set.
# Re-run temperature scaling on the Colab notebook to update this if you retrain.
DEFAULT_TEMPERATURE = 1.8


class TextDetector:
    """
    AI text detection using the fine-tuned DistilBERT model.
    Trained on HC3 (Reddit Q&A) + RAID (multi-domain, multi-generator) datasets.
    """

    def __init__(
        self,
        model_path: str | Path = DEFAULT_MODEL_PATH,
        temperature: float = DEFAULT_TEMPERATURE,
    ):
        model_path = str(model_path)
        print(f"Loading text model from: {model_path}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.model.eval()
        self.temperature = temperature
        print("Text model loaded.")

    @torch.no_grad()
    def predict(self, text: str, threshold: float = 0.85) -> dict:
        """
        Predict whether text is AI-generated.

        Args:
            text: The text to analyze.
            threshold: Minimum confidence to make a call. Below this returns "uncertain".

        Returns:
            dict with keys: ai_prob, human_prob, pred ("ai" | "human" | "uncertain")
        """
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=256,
            padding=True,
        )

        logits = self.model(**inputs).logits[0]
        probs = F.softmax(logits / self.temperature, dim=-1).numpy()

        ai_prob = float(probs[1])
        human_prob = float(probs[0])

        if max(ai_prob, human_prob) < threshold:
            pred = "uncertain"
        else:
            pred = "ai" if ai_prob >= human_prob else "human"

        return {"ai_prob": ai_prob, "human_prob": human_prob, "pred": pred}


class ImageDetector:
    """
    Image AI-detection model.
    Not currently supported — returns a neutral score.
    """

    def predict(self, image_data: str) -> float:
        return 0.5
