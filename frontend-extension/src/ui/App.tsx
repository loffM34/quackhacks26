// ──────────────────────────────────────────────────────────
// App — Root component for popup and sidepanel
// ──────────────────────────────────────────────────────────
// Manages navigation between Badge view, SidePanel, and Settings.

import React, { useState } from "react";
import { FloatingBadge } from "./FloatingBadge";
import { SidePanel } from "./SidePanel";
import { Settings } from "./Settings";

type View = "badge" | "panel" | "settings";

interface AppProps {
  /** If true, start in panel view (used by sidepanel entry) */
  defaultView?: View;
}

export const App: React.FC<AppProps> = ({ defaultView = "badge" }) => {
  const [view, setView] = useState<View>(defaultView);

  return (
    <div className="min-h-full">
      {view === "badge" && (
        <div>
          <FloatingBadge onExpand={() => setView("panel")} />
          <div className="px-4 pb-2">
            <button
              className="text-[10px] text-glass-text-dim hover:text-glass-text-muted transition-colors"
              onClick={() => setView("settings")}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
      )}

      {view === "panel" && (
        <div>
          <div className="p-2">
            <button
              className="text-xs text-glass-text-muted hover:text-glass-text transition-colors"
              onClick={() => setView("badge")}
            >
              ← Compact view
            </button>
          </div>
          <SidePanel />
          <div className="px-4 pb-3">
            <button
              className="text-[10px] text-glass-text-dim hover:text-glass-text-muted transition-colors"
              onClick={() => setView("settings")}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
      )}

      {view === "settings" && (
        <Settings
          onBack={() => setView(defaultView === "panel" ? "panel" : "badge")}
        />
      )}
    </div>
  );
};

export default App;
