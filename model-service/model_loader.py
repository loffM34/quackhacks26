"""
Model Loader — AI Content Detection Models
===========================================
Loads the fine-tuned DistilBERT model trained on HC3 + RAID datasets.

Usage:
  detector = TextDetector()
  result = detector.predict("Some text to analyze")
  # result = {"ai_prob": 0.91, "human_prob": 0.09, "pred": "ai"}
"""

import json
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from pathlib import Path

# Path to the fine-tuned model files (relative to this file)
DEFAULT_MODEL_PATH = Path(__file__).parent / "model"

# Fallback temperature if training_config.json is not found.
# The Colab notebook saves the calibrated value automatically — prefer that.
DEFAULT_TEMPERATURE = 1.8


def _load_temperature(model_path: Path) -> float:
    config_file = model_path / "training_config.json"
    if config_file.exists():
        try:
            with open(config_file) as f:
                cfg = json.load(f)
            t = float(cfg.get("temperature", DEFAULT_TEMPERATURE))
            print(f"Temperature loaded from training_config.json: {t}")
            return t
        except Exception as e:
            print(f"Could not read training_config.json ({e}), using default {DEFAULT_TEMPERATURE}")
    return DEFAULT_TEMPERATURE


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
        
        # Check if the model weights actually exist locally
        local_safetensors = Path(model_path) / "model.safetensors"
        local_bin = Path(model_path) / "pytorch_model.bin"
        
        if not (local_safetensors.exists() and local_safetensors.stat().st_size > 0) and not (local_bin.exists() and local_bin.stat().st_size > 0):
            print(f"Local model weights not found in {model_path}.")
            print("Downloading compatible pre-trained model from Hugging Face Hub (openai-community/roberta-base-openai-detector)...")
            model_path = "openai-community/roberta-base-openai-detector"
        else:
            print(f"Loading text model from local path: {model_path}")

        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.model.eval()
        # Use calibrated temperature from training_config.json if available,
        # otherwise fall back to the constructor argument.
        self.temperature = _load_temperature(Path(model_path)) if temperature == DEFAULT_TEMPERATURE else temperature
        print(f"Text model loaded. Temperature: {self.temperature}")

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
            max_length=512,
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

    def predict_batch(self, texts: list[str], threshold: float = 0.85) -> list[float]:
        """
        Predict AI probability for a batch of texts.

        Returns:
            List of ai_prob scores (one per text).
        """
        return [self.predict(text, threshold)["ai_prob"] for text in texts]

class ImageDetector:
    """
    Image AI-detection model.
    Not currently supported — returns a neutral score.
    """

    def __init__(self, model_name=None):
        self.model_name = model_name

    def predict(self, image_data: str) -> float:
        return 0.5

