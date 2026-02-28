// ──────────────────────────────────────────────────────────
// Settings — privacy, backend config, and user preferences
// ──────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import clsx from "clsx";
import { loadSettings, updateSettings } from "../utils/api";
import type { ShieldSettings } from "../types";

export const Settings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [settings, setSettings] = useState<ShieldSettings | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const handleUpdate = (partial: Partial<ShieldSettings>) => {
    if (!settings) return;
    const updated = { ...settings, ...partial };
    setSettings(updated);
    updateSettings(partial);
  };

  if (!settings) return null;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="glass-btn px-2 py-1 text-xs">
          ← Back
        </button>
        <h1 className="text-lg font-bold text-glass-100">Settings</h1>
      </div>

      {/* Privacy section */}
      <div className="glass-panel p-4 space-y-3">
        <h2 className="text-sm font-semibold text-glass-200">🔒 Privacy</h2>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-glass-text">
              Send content for analysis
            </div>
            <div className="text-[10px] text-glass-text-dim">
              Required for AI detection. Content is processed securely.
            </div>
          </div>
          <button
            className={clsx(
              "toggle-switch",
              settings.privacyConsent && "active",
            )}
            onClick={() =>
              handleUpdate({ privacyConsent: !settings.privacyConsent })
            }
          >
            <span className="toggle-dot" />
          </button>
        </div>

        <button
          className="glass-btn w-full text-center text-xs"
          onClick={() => setShowPrivacyModal(true)}
        >
          📋 What data do we send?
        </button>
      </div>

      {/* Google search dots */}
      <div className="glass-panel p-4 space-y-3">
        <h2 className="text-sm font-semibold text-glass-200">
          🔍 Search Results
        </h2>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-glass-text">
              Show dots on Google results
            </div>
            <div className="text-[10px] text-glass-text-dim">
              Tiny indicators next to search result titles
            </div>
          </div>
          <button
            className={clsx(
              "toggle-switch",
              settings.showSearchDots && "active",
            )}
            onClick={() =>
              handleUpdate({ showSearchDots: !settings.showSearchDots })
            }
          >
            <span className="toggle-dot" />
          </button>
        </div>
      </div>

      {/* Backend URL (advanced) */}
      <div className="glass-panel p-4 space-y-3">
        <h2 className="text-sm font-semibold text-glass-200">⚙️ Advanced</h2>
        <div>
          <label className="text-xs text-glass-text-muted block mb-1">
            Backend URL
          </label>
          <input
            className="glass-input"
            value={settings.backendUrl}
            onChange={(e) => handleUpdate({ backendUrl: e.target.value })}
            placeholder="http://localhost:3001"
          />
        </div>
      </div>

      {/* Privacy modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel p-5 m-4 max-w-sm space-y-3">
            <h3 className="text-base font-bold text-glass-100">What We Send</h3>
            <ul className="text-xs text-glass-text-muted space-y-1.5 list-disc pl-4">
              <li>
                Up to 20 text paragraphs (cleaned, no PII redaction by default)
              </li>
              <li>Up to 5 compressed images (≤800px, JPEG)</li>
              <li>Page URL (for caching only, not stored long-term)</li>
              <li>No cookies, passwords, or form data</li>
              <li>Backend logs only hashes + scores (no raw content)</li>
            </ul>
            <p className="text-[10px] text-glass-text-dim">
              Content is sent to your configured backend over HTTPS. No data is
              shared with third parties beyond the configured detection API
              provider.
            </p>
            <button
              className="glass-btn w-full text-center"
              onClick={() => setShowPrivacyModal(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
