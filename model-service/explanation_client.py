"""
Featherless / Gemma explanation client.
Used only for medium/high flags after local detection has already run.
"""

from __future__ import annotations

from openai import OpenAI


class FeatherlessExplainer:
    def __init__(self, api_key: str, model: str, base_url: str = "https://api.featherless.ai/v1"):
        self.model = model
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def explain_text_chunk(self, text: str, score: float, tier: str) -> str:
        prompt = f"""
You are explaining why a detector flagged a text chunk as possibly AI-generated.

Rules:
- Be cautious and avoid certainty.
- Do not mention hidden weights, logits, probabilities, or internal model mechanics.
- Mention only observable writing patterns.
- 1-2 short sentences.
- If the signal is moderate, say that clearly.
- Plain text only.

Detector score: {score:.2f}
Tier: {tier}

Text:
{text}
""".strip()

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=120,
        )
        return response.choices[0].message.content.strip()

    def explain_image(self, image_data_uri: str, score: float, tier: str) -> str:
        content = [
            {
                "type": "text",
                "text": f"""
You are explaining why an image detector flagged an image as possibly AI-generated.

Rules:
- Be cautious and avoid certainty.
- Mention only visible image patterns.
- Do not claim you know the source model.
- 1-2 short sentences.
- If the signal is moderate, say that clearly.
- Plain text only.

Detector score: {score:.2f}
Tier: {tier}
""".strip(),
            },
            {
                "type": "image_url",
                "image_url": {"url": image_data_uri},
            },
        ]

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": content}],
            temperature=0.2,
            max_tokens=120,
        )
        return response.choices[0].message.content.strip()