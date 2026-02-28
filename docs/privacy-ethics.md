# Privacy, Ethics & Legal Notes — AI Content Shield

## Core Principle

**All detection results are probabilistic estimates, not definitive judgments.**

---

## Required UI Language

### ✅ DO use:

- "This content is **likely** AI-generated (score: XX%)"
- "This is a **probabilistic estimate** and may be incorrect"
- "**Some signals** suggest this content may be AI-generated"
- "Click for details about how this score was calculated"

### ❌ DO NOT use:

- "This is AI-generated" (definitive)
- "This is fake" (inflammatory)
- "This content is not real" (misleading)
- "AI detected!" (alarming)

### Blur Label Format

```
Hidden: likely AI (XX%) — show anyway
```

---

## Privacy Commitments

### What we collect

- Text paragraphs from web pages (up to 20, cleaned)
- Compressed images (up to 5, ≤800px JPEG)
- Page URL (for caching, not stored long-term)

### What we DO NOT collect

- Cookies, session tokens, or authentication data
- Form inputs, passwords, or personal information
- Browsing history beyond the current analysis
- Any data when privacy toggle is OFF

### Data handling

- Content is sent to the configured backend over HTTPS
- Backend logs only content hashes and scores (not raw text)
- No raw content is persisted unless the user opts in
- Cache entries expire after 10 minutes
- No data is sold or shared with third parties

### User controls

- **Privacy toggle**: stops all content analysis when OFF
- **"What we send" modal**: transparent data disclosure
- **Backend URL config**: users can point to their own backend

---

## Legal Considerations

### False positives

AI detection tools have significant false positive rates (5–20% depending on the tool and content type). Users must understand:

- Scores are **estimates**, not facts
- Human-written content can score high
- AI-assisted content (human + AI) creates ambiguous results
- Short text snippets are less reliable than longer passages

### Accessibility

- **Elder Mode** provides larger fonts (18px+) for older users
- Color coding is supplemented with text labels (not color-only)
- All interactive elements have ARIA labels
- Minimum touch target sizes (44px in Elder Mode)

### API provider terms

When using external APIs (GPTZero, Originality.ai, Sapling, HuggingFace):

- Comply with each provider's Terms of Service
- Respect rate limits and usage quotas
- Do not cache results beyond the provider's allowed retention period
- Ensure API keys are stored securely (env vars, not in code)

### Extension store compliance

- Chrome Web Store requires privacy policy disclosure
- Manifest permissions should be minimized to what's needed
- `<all_urls>` permission requires justification in store listing
- Consider narrowing host_permissions for production release

---

## Ethical Guidelines

1. **Never claim certainty** — AI detection is inherently probabilistic
2. **Empower, don't alarm** — help users make informed decisions
3. **Respect user agency** — always allow "show anyway" for blurred content
4. **Minimize data collection** — collect only what's needed for analysis
5. **Be transparent** — clearly explain what data is sent and how it's used
6. **Avoid bias** — don't discriminate against AI-assisted writing
7. **Support accessibility** — ensure the tool is usable by everyone
