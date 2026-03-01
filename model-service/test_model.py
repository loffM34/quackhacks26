from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

model = AutoModelForSequenceClassification.from_pretrained("./model")
tokenizer = AutoTokenizer.from_pretrained("./model")
model.eval()

T = 1.8  # calibrated temperature

def score(text):
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        logits = model(**inputs).logits[0]
    probs = torch.softmax(logits / T, dim=-1).numpy()
    print(f"AI: {probs[1]:.2%}  Human: {probs[0]:.2%}")

score("paste any text here to test")