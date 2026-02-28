# Demo Script — AI Content Shield

## 5-Minute Judge Presentation

### 1. Problem Statement (30s)

**"AI-generated content is everywhere, and most people can't tell the difference."**

- News articles, blog posts, images — AI content is indistinguishable from human content
- No existing browser-native tool scores pages passively and non-invasively
- AI Content Shield: a Chrome extension that detects and surfaces AI-generated content with a single glance

---

### 2. The Badge — First Impression (60s)

1. Open a news article (e.g., https://www.bbc.com/news or any blog post)
2. Point to the **floating badge** in the bottom-right corner: **"AI: 35%"** (green)
3. Explain: "This badge appears passively — no clicks needed. Green means low probability."
4. Navigate to a page with known AI content (use test page or ChatGPT-generated article)
5. Show the badge turning **red**: **"AI: 82%"**
6. _Expected latency: < 2 seconds for the score to appear_

### 3. Side Panel Deep Dive (60s)

1. **Click the badge** → side panel opens
2. Walk through:
   - **Page score**: large percentage with color indicator
   - **Breakdown**: text vs image scores
   - **AI Density**: "72% of paragraphs flagged"
   - **Per-paragraph list**: individual scores with previews
3. **Threshold slider**: drag it to 50% → more content gets flagged
4. **Analyze button**: click for on-demand re-scan

### 4. Blur Feature (45s)

1. Toggle **"Auto-blur above threshold"** ON
2. Show paragraphs that are blurred with the label: _"Hidden: likely AI (78%) — show anyway"_
3. Click **"show anyway"** to reveal one paragraph
4. Emphasize: "Probabilistic, never absolute. Users always have control."

### 5. Google Search Integration (30s)

1. Navigate to Google and search for something
2. Point to the **tiny colored dots** next to search result titles
3. Explain: "Minimal DOM mutation — no reordering, no page shifts, just awareness"

### 6. Architecture & Provider Switching (60s)

1. Open the **backend health endpoint**: `http://localhost:3001/health`
2. Show: provider = "api", cache stats, latency metrics
3. Explain the adapter pattern:
   - "We started with GPTZero API for the hackathon"
   - "But the backend has a provider interface"
4. Show `.env` file: change `DETECT_PROVIDER=python`
5. Restart backend → health now shows provider = "python"
6. Show the **FastAPI stub** running at `localhost:8000/health`
7. "Zero frontend changes needed. Drop in your own models later."

### 7. Privacy & Ethics (30s)

- Show the **Settings panel** with privacy toggle
- Show **"What data do we send?"** modal
- Emphasize: "All language is probabilistic — 'likely AI-generated', never 'this is fake'"
- "API keys never leave the backend. Content is not stored."

---

## Demo Artifacts to Prepare

### Test Pages

- [ ] A human-written news article (BBC, NYT, etc.)
- [ ] A ChatGPT-generated article (save as local HTML or use a blog post)
- [ ] A page with AI-generated images (Midjourney/DALL-E showcase)
- [ ] Google search results page

### Backend

- [ ] Backend running on `localhost:3001` with `DETECT_PROVIDER=api`
- [ ] At least one API key configured (or use mock mode)
- [ ] Health endpoint accessible: `localhost:3001/health`

### Extension

- [ ] Built and loaded as unpacked extension in Chrome
- [ ] Badge visible on test pages

### Model Service (optional)

- [ ] FastAPI running on `localhost:8000`
- [ ] Health endpoint accessible: `localhost:8000/health`

---

## Expected Results

| Test Page          | Expected Score  | Expected Latency |
| ------------------ | --------------- | ---------------- |
| BBC News article   | 15–35% (green)  | < 2s             |
| ChatGPT blog post  | 70–90% (red)    | < 2s             |
| Mixed content page | 40–65% (yellow) | < 2s             |
| AI image gallery   | 60–85% (red)    | < 3s             |

## Troubleshooting

- If badge doesn't appear: check extension loaded, check console for errors
- If score is 0: backend probably unreachable, check CORS / network
- If all scores are similar: you're in mock mode (no API keys configured)
