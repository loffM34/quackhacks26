"""
Model Loader — AI Content Detection Models
===========================================
Template for loading HuggingFace / PyTorch / ONNX models.

Usage:
  text_detector = TextDetector()
  score = text_detector.predict("Some text to analyze")

  image_detector = ImageDetector()
  score = image_detector.predict(base64_image_string)
"""

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
# from optimum.onnxruntime import ORTModelForSequenceClassification  # uncomment for ONNX
import base64
from io import BytesIO
from PIL import Image
import numpy as np


class TextDetector:
    """
    Text AI-detection model using HuggingFace Transformers.
    
    Recommended models:
      - "openai-community/roberta-base-openai-detector" (lightweight, fast)
      - "Hello-SimpleAI/chatgpt-detector-roberta" (ChatGPT-specific)
      - Custom fine-tuned model
    """
    
    def __init__(self, model_name: str = "openai-community/roberta-base-openai-detector"):
        print(f"Loading text model: {model_name}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.eval()
        
        # Optional: use ONNX for faster inference
        # self.model = ORTModelForSequenceClassification.from_pretrained(model_name)
        
        print(f"✅ Text model loaded: {model_name}")
    
    @torch.no_grad()
    def predict(self, text: str) -> float:
        """
        Predict AI-generated probability for text.
        Returns: float 0.0–1.0 (higher = more likely AI)
        """
        # Tokenize
        inputs = self.tokenizer(
            text, 
            return_tensors="pt", 
            truncation=True, 
            max_length=512,
            padding=True,
        )
        
        # Inference
        outputs = self.model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        
        # Index 0 = "Real", Index 1 = "Fake/AI" (for roberta-base-openai-detector)
        # Adjust indices based on your model's label mapping
        ai_prob = probs[0][1].item()
        
        return ai_prob


class ImageDetector:
    """
    Image AI-detection model.
    
    Recommended models:
      - "umm-maybe/AI-image-detector" (ViT-based)
      - Custom fine-tuned model for DALL-E / Midjourney / SD detection
    """
    
    def __init__(self, model_name: str = "umm-maybe/AI-image-detector"):
        from transformers import AutoFeatureExtractor, AutoModelForImageClassification
        
        print(f"Loading image model: {model_name}")
        self.extractor = AutoFeatureExtractor.from_pretrained(model_name)
        self.model = AutoModelForImageClassification.from_pretrained(model_name)
        self.model.eval()
        print(f"✅ Image model loaded: {model_name}")
    
    @torch.no_grad()
    def predict(self, image_data: str) -> float:
        """
        Predict AI-generated probability for an image.
        Input: base64 data URI string
        Returns: float 0.0–1.0
        """
        # Decode base64 to PIL Image
        base64_str = image_data.split(",")[-1]  # remove data URI prefix
        image_bytes = base64.b64decode(base64_str)
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        
        # Preprocess
        inputs = self.extractor(images=image, return_tensors="pt")
        
        # Inference
        outputs = self.model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        
        # Look for the "artificial" / "AI" label
        # Adjust label index based on your model
        ai_prob = probs[0][1].item()  # typically index 1 = artificial
        
        return ai_prob
