// ──────────────────────────────────────────────────────────
// SidePanel — detailed AI analysis breakdown
// ──────────────────────────────────────────────────────────
// Shows page-level score, text vs image breakdown, AI density,
// per-paragraph/image scores, threshold slider with blur toggle,
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

  // Load cached result and settings on mount
  useEffect(() => {
    getCachedResult().then(setAnalysis);
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
    const result = await requestAnalysis();
    if (result) setAnalysis(result);
    setLoading(false);
  };

  const handleThresholdChange = useCallback((value: number) => {
    setThreshold(value);
    updateSettings({ threshold: value });
  }, []);

  const handleAutoBlurToggle = useCallback(() => {
    const next = !autoBlur;
    setAutoBlur(next);
    updateSettings({ autoBlur: next });
    // If enabling, also tell the content script to blur now
    if (next) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "BLUR_CONTENT" });
        }
      });
    }
  }, [autoBlur]);

  const handleElderModeToggle = useCallback(() => {
    const next = !elderMode;
    setElderMode(next);
    updateSettings({ elderMode: next });
  }, [elderMode]);

  const score = analysis?.overallScore ?? 0;
  const color = getScoreColor(score);

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
              <p className="text-xs text-glass-text-muted mt-1">
                Likely AI-generated content
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
          <h2 className="text-sm font-semibold text-glass-200">Breakdown</h2>

          {/* Text vs Image scores */}
          <div className="grid grid-cols-3 gap-3">
            <ScoreStat label="Text" value={analysis.textScore} />
            <ScoreStat label="Images" value={analysis.imageScore} />
            <ScoreStat label="AI Density" value={analysis.aiDensity} />
          </div>

          <div className="glass-divider" />

          {/* Per-item details */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {analysis.items.map((item) => (
              <ContentItemRow key={item.id} item={item} threshold={threshold} />
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
            <span>Blur threshold</span>
            <span className="font-mono">{threshold}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => handleThresholdChange(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-glass-text-dim mt-0.5">
            <span>Lenient</span>
            <span>Strict</span>
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

const ContentItemRow: React.FC<{ item: ContentScore; threshold: number }> = ({
  item,
  threshold,
}) => {
  const flagged = item.score > threshold;
  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-xs p-2 rounded-lg",
        flagged ? "bg-red-500/10" : "bg-glass-800/30",
      )}
    >
      <span>{item.type === "text" ? "📝" : "🖼️"}</span>
      <span className="flex-1 truncate text-glass-text-muted">
        {item.preview}
      </span>
      <span
        className={clsx(
          "font-mono font-semibold",
          getScoreColorClass(item.score),
        )}
      >
        {item.score}%
      </span>
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
