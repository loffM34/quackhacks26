// ──────────────────────────────────────────────────────────
// FloatingBadge — compact AI score indicator
// ──────────────────────────────────────────────────────────
// Rendered in the popup. Shows "AI: XX% ⓘ" with color coding.
// Green (≤40%), Yellow (40-70%), Red (>70%).
// Click expands to show the SidePanel.

import React, { useEffect, useState } from "react";
import clsx from "clsx";
import { getCachedResult, requestAnalysis } from "../utils/api";
import type { PageAnalysis } from "../types";
import { getScoreColor } from "../types";

interface FloatingBadgeProps {
  onExpand: () => void;
}

export const FloatingBadge: React.FC<FloatingBadgeProps> = ({ onExpand }) => {
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Load cached result on mount
  useEffect(() => {
    getCachedResult().then((result) => {
      if (result) setAnalysis(result);
    });
  }, []);

  // Listen for analysis updates from background
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
    if (result) {
      setAnalysis(result);
    }
    setLoading(false);
  };

  const score = analysis?.overallScore ?? 0;
  const color = getScoreColor(score);

  const colorClasses = {
    safe: "text-score-safe",
    caution: "text-score-caution",
    danger: "text-score-danger",
  };

  const glowColors = {
    safe: "rgba(34, 197, 94, 0.2)",
    caution: "rgba(234, 179, 8, 0.2)",
    danger: "rgba(239, 68, 68, 0.2)",
  };

  return (
    <div className="p-4 animate-fade-in">
      {/* Badge pill */}
      <div
        className={clsx(
          "glass-panel glass-panel-hover cursor-pointer transition-all duration-200",
          "flex items-center gap-2 px-4 py-3",
          hovered && "scale-[1.02]",
        )}
        style={{
          boxShadow: analysis
            ? `0 4px 16px rgba(10,26,74,0.4), 0 0 20px 2px ${glowColors[color]}`
            : undefined,
        }}
        onClick={onExpand}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Shield icon */}
        <div className="text-lg">🛡️</div>

        {/* Score display */}
        <div className="flex-1">
          <div className="text-sm font-semibold text-glass-100">
            AI Content Shield
          </div>
          {analysis ? (
            <div className={clsx("text-xl font-bold", colorClasses[color])}>
              AI: {score}% <span className="text-xs opacity-60">ⓘ</span>
            </div>
          ) : (
            <div className="text-sm text-glass-text-muted">
              {loading ? "Analyzing…" : "Not analyzed yet"}
            </div>
          )}
        </div>

        {/* Cached indicator */}
        {analysis?.cached && (
          <span className="text-[10px] text-glass-text-dim bg-glass-800/50 px-1.5 py-0.5 rounded">
            cached
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-3 flex gap-2">
        <button
          className="glass-btn flex-1 text-center"
          onClick={handleAnalyze}
          disabled={loading}
        >
          {loading ? "⏳ Analyzing…" : "🔍 Analyze Page"}
        </button>
        <button
          className="glass-btn px-3"
          onClick={onExpand}
          title="Open detailed panel"
        >
          📊
        </button>
      </div>

      {/* Quick summary bar (only if analysis exists) */}
      {analysis && (
        <div className="mt-3 space-y-2 animate-fade-in">
          {/* Progress bar */}
          <div className="glass-progress">
            <div
              className={clsx("glass-progress-bar", {
                "bg-score-safe": color === "safe",
                "bg-score-caution": color === "caution",
                "bg-score-danger": color === "danger",
              })}
              style={{ width: `${score}%` }}
            />
          </div>

          {/* Mini stats */}
          <div className="flex justify-between text-xs text-glass-text-muted">
            <span>Text: {analysis.textScore}%</span>
            <span>Images: {analysis.imageScore}%</span>
            <span>Density: {analysis.aiDensity}%</span>
          </div>

          {/* Probabilistic disclaimer */}
          <p className="text-[10px] text-glass-text-dim leading-tight mt-1">
            This score is <strong>probabilistic</strong> and may be incorrect.
            Click ⓘ for details.
          </p>
        </div>
      )}
    </div>
  );
};

export default FloatingBadge;
