// ──────────────────────────────────────────────────────────
// SidePanel — detailed AI analysis breakdown
// ──────────────────────────────────────────────────────────
// Shows page-level score, text vs image breakdown, AI density,
// per-paragraph/image scores with click-to-highlight and
// individual detail cards. Threshold slider with blur toggle,
// and Elder Mode toggle.

import React, { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import {
  getCachedResult,
  requestAnalysis,
  updateSettings,
  loadSettings,
} from "../utils/api";
import type { PageAnalysis, ShieldSettings, ContentScore } from "../types";
import { getScoreColor, getScoreColorClass } from "../types";

export const SidePanel: React.FC = () => {
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [settings, setSettings] = useState<ShieldSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(70);
  const [autoBlur, setAutoBlur] = useState(false);
  const [elderMode, setElderMode] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Load cached result and settings on mount
  useEffect(() => {
    getCachedResult().then((result) => {
      if (result) setAnalysis(result);
    });
    loadSettings().then((s) => {
      setSettings(s);
      setThreshold(s.threshold);
      setAutoBlur(s.autoBlur);
      setElderMode(s.elderMode);
    });
  }, []);

  // Listen for analysis updates
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === "ANALYSIS_RESULT") {
        setAnalysis(message.payload);
        setLoading(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const result = await requestAnalysis();
      if (result) setAnalysis(result);
    } catch (err) {
      console.error("[SidePanel] Analysis failed:", err);
    }
    setLoading(false);
  };

  // Helper: send a RECALCULATE_BLUR message to the active tab's content script
  const triggerBlurRecalculation = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "RECALCULATE_BLUR" });
      }
    });
  }, []);

  // Update threshold visually during drag (no re-evaluation)
  const handleThresholdInput = useCallback((value: number) => {
    setThreshold(value);
  }, []);

  // Commit threshold on mouse-up/touch-end and trigger re-evaluation
  const handleThresholdCommit = useCallback(
    (value: number) => {
      setThreshold(value);
      updateSettings({ threshold: value });
      triggerBlurRecalculation();
    },
    [triggerBlurRecalculation],
  );

  const handleAutoBlurToggle = useCallback(() => {
    const next = !autoBlur;
    setAutoBlur(next);
    updateSettings({ autoBlur: next });
    // Trigger recalculation for BOTH enable and disable
    triggerBlurRecalculation();
  }, [autoBlur, triggerBlurRecalculation]);

  const handleElderModeToggle = useCallback(() => {
    const next = !elderMode;
    setElderMode(next);
    updateSettings({ elderMode: next });
  }, [elderMode]);

  const handleItemClick = (item: ContentScore) => {
    // Toggle expanded state
    setExpandedItem(expandedItem === item.id ? null : item.id);

    // Highlight on the page — send a message to content script
    if (item.type === "text" && item.preview) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "HIGHLIGHT_ITEM",
            payload: { preview: item.preview, id: item.id },
          });
        }
      });
    }
  };

  const score = analysis?.overallScore ?? 0;
  const color = getScoreColor(score);

  // Helpers for readable labels
  const getScoreLabel = (s: number) => {
    if (s <= 20) return "Very likely human-written";
    if (s <= 40) return "Probably human-written";
    if (s <= 60) return "Uncertain — could be either";
    if (s <= 80) return "Likely AI-generated";
    return "Very likely AI-generated";
  };

  const getConfidenceLevel = (s: number) => {
    if (s <= 20 || s >= 80) return "High confidence";
    if (s <= 35 || s >= 65) return "Moderate confidence";
    return "Low confidence";
  };

  return (
    <div
      className={clsx(
        "min-h-screen p-4 space-y-4 animate-fade-in",
        elderMode && "elder-mode",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">🛡️</span>
        <h1 className="text-lg font-bold text-glass-100">AI Content Shield</h1>
      </div>

      {/* ── Page Score Card ── */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-glass-text-muted">Page Score</span>
          {analysis?.cached && (
            <span className="text-[10px] text-glass-text-dim bg-glass-800/50 px-1.5 py-0.5 rounded">
              cached
            </span>
          )}
        </div>

        {analysis ? (
          <>
            {/* Large score display */}
            <div className="text-center py-2">
              <div
                className={clsx(
                  "text-5xl font-black",
                  getScoreColorClass(score),
                )}
              >
                {score}%
              </div>
              <p className="text-sm text-glass-text-muted mt-1">
                {getScoreLabel(score)}
              </p>
              <p className="text-[10px] text-glass-text-dim mt-0.5">
                {getConfidenceLevel(score)}
              </p>
            </div>

            {/* Score color indicator */}
            <div className="flex justify-center">
              <span className={clsx("score-pill", color)}>
                {color === "safe" && "✅ Low AI probability"}
                {color === "caution" && "⚠️ Moderate AI signals"}
                {color === "danger" && "🔴 High AI probability"}
              </span>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-glass-text-muted">
              {loading ? "⏳ Analyzing page…" : "Page not analyzed yet"}
            </p>
          </div>
        )}

        {/* Analyze button */}
        <button
          className="glass-btn w-full text-center"
          onClick={handleAnalyze}
          disabled={loading}
        >
          {loading ? "⏳ Analyzing…" : "🔍 Analyze This Page"}
        </button>
      </div>

      {/* ── Breakdown Card ── */}
      {analysis && (
        <div className="glass-panel p-4 space-y-3 animate-fade-in">
          <h2 className="text-sm font-semibold text-glass-200">
            Content Breakdown
          </h2>

          {/* Text vs Image scores */}
          <div className="grid grid-cols-3 gap-3">
            <ScoreStat label="📝 Text" value={analysis.textScore} />
            <ScoreStat label="🖼️ Images" value={analysis.imageScore} />
            <ScoreStat label="📊 Density" value={analysis.aiDensity} />
          </div>

          {/* Readable explanation */}
          <div className="text-xs text-glass-text-muted bg-glass-800/30 p-2 rounded-lg">
            {analysis.items.filter((i) => i.type === "text").length} text
            sections and{" "}
            {analysis.items.filter((i) => i.type === "image").length} images
            analyzed.{" "}
            {analysis.aiDensity > 50
              ? `${analysis.aiDensity}% of text sections show AI patterns.`
              : `Most content appears human-written.`}
          </div>

          <div className="glass-divider" />

          {/* Per-item details — clickable and expandable */}
          <h3 className="text-xs font-semibold text-glass-text-muted">
            Detected Items{" "}
            <span className="text-glass-text-dim font-normal">
              (click to highlight on page)
            </span>
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {analysis.items.map((item) => (
              <ContentItemRow
                key={item.id}
                item={item}
                threshold={threshold}
                expanded={expandedItem === item.id}
                onClick={() => handleItemClick(item)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Controls Card ── */}
      <div className="glass-panel p-4 space-y-4">
        <h2 className="text-sm font-semibold text-glass-200">Controls</h2>

        {/* Threshold slider */}
        <div>
          <div className="flex justify-between text-xs text-glass-text-muted mb-1">
            <span>AI Score Threshold</span>
            <span className="font-mono">{threshold}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={threshold}
            onInput={(e) =>
              handleThresholdInput(Number((e.target as HTMLInputElement).value))
            }
            onChange={(e) => handleThresholdCommit(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-glass-text-dim mt-0.5">
            <span>Aggressive (0%)</span>
            <span>Cautious (100%)</span>
          </div>
        </div>

        <div className="glass-divider" />

        {/* Auto-blur toggle */}
        <ToggleRow
          label="Auto-blur above threshold"
          description="Blur paragraphs scoring above your threshold"
          active={autoBlur}
          onToggle={handleAutoBlurToggle}
        />

        {/* Elder Mode toggle */}
        <ToggleRow
          label="Elder Mode"
          description="Larger fonts and simplified interface"
          active={elderMode}
          onToggle={handleElderModeToggle}
        />
      </div>

      {/* ── Privacy notice ── */}
      <div className="text-[10px] text-glass-text-dim text-center px-4 leading-snug">
        This score is <strong>probabilistic</strong> and may be incorrect.
        Content is sent to a secure backend for analysis.
        <br />
        <a href="#" className="underline hover:text-glass-text-muted">
          Privacy details →
        </a>
      </div>
    </div>
  );
};

// ── Sub-components ──

const ScoreStat: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="text-center">
    <div className={clsx("text-2xl font-bold", getScoreColorClass(value))}>
      {value}%
    </div>
    <div className="text-[11px] text-glass-text-muted">{label}</div>
  </div>
);

interface ContentItemRowProps {
  item: ContentScore;
  threshold: number;
  expanded: boolean;
  onClick: () => void;
}

const ContentItemRow: React.FC<ContentItemRowProps> = ({
  item,
  threshold,
  expanded,
  onClick,
}) => {
  const flagged = item.score > threshold;
  const scoreLabel =
    item.score <= 30
      ? "Human"
      : item.score <= 60
        ? "Mixed"
        : item.score <= 80
          ? "Likely AI"
          : "AI";

  // Truncate preview for readability
  const shortPreview = item.preview
    ? item.preview.length > 80
      ? item.preview.slice(0, 80) + "…"
      : item.preview
    : "No preview available";

  return (
    <div
      className={clsx(
        "rounded-lg cursor-pointer transition-all duration-200",
        flagged
          ? "bg-red-500/10 hover:bg-red-500/20"
          : "bg-glass-800/30 hover:bg-glass-800/50",
        expanded && "ring-1 ring-glass-400/30",
      )}
      onClick={onClick}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 text-xs p-2.5">
        <span className="text-base">{item.type === "text" ? "📝" : "🖼️"}</span>
        <div className="flex-1 min-w-0">
          <span className="text-glass-text-muted block truncate">
            {shortPreview}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded font-medium",
              item.score <= 30
                ? "bg-green-500/20 text-green-400"
                : item.score <= 60
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-red-500/20 text-red-400",
            )}
          >
            {scoreLabel}
          </span>
          <span
            className={clsx(
              "font-mono font-semibold text-sm",
              getScoreColorClass(item.score),
            )}
          >
            {item.score}%
          </span>
        </div>
      </div>

      {/* Expanded detail card */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-glass-700/30 space-y-2 animate-fade-in">
          {/* Full preview text */}
          <div className="text-[11px] text-glass-text leading-relaxed bg-glass-900/40 p-2 rounded">
            {item.preview || "No text content available"}
          </div>

          {/* Score breakdown */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-glass-800/40 p-1.5 rounded">
              <span className="text-glass-text-dim">Type:</span>{" "}
              <span className="text-glass-text">
                {item.type === "text" ? "Text section" : "Image"}
              </span>
            </div>
            <div className="bg-glass-800/40 p-1.5 rounded">
              <span className="text-glass-text-dim">Provider:</span>{" "}
              <span className="text-glass-text">{item.provider}</span>
            </div>
            <div className="bg-glass-800/40 p-1.5 rounded">
              <span className="text-glass-text-dim">AI Score:</span>{" "}
              <span className={getScoreColorClass(item.score)}>
                {item.score}%
              </span>
            </div>
            <div className="bg-glass-800/40 p-1.5 rounded">
              <span className="text-glass-text-dim">Verdict:</span>{" "}
              <span className="text-glass-text">
                {item.score <= 30
                  ? "Likely human"
                  : item.score <= 60
                    ? "Uncertain"
                    : "Likely AI"}
              </span>
            </div>
          </div>

          {/* Visual score bar */}
          <div className="glass-progress h-1.5">
            <div
              className={clsx("glass-progress-bar h-full rounded-full", {
                "bg-score-safe": item.score <= 40,
                "bg-score-caution": item.score > 40 && item.score <= 70,
                "bg-score-danger": item.score > 70,
              })}
              style={{ width: `${item.score}%` }}
            />
          </div>

          <p className="text-[9px] text-glass-text-dim italic">
            Click to scroll to this content on the page
          </p>
        </div>
      )}
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  description: string;
  active: boolean;
  onToggle: () => void;
}> = ({ label, description, active, onToggle }) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-sm text-glass-text">{label}</div>
      <div className="text-[10px] text-glass-text-dim">{description}</div>
    </div>
    <button
      className={clsx("toggle-switch", active && "active")}
      onClick={onToggle}
      role="switch"
      aria-checked={active}
    >
      <span className="toggle-dot" />
    </button>
  </div>
);

export default SidePanel;
