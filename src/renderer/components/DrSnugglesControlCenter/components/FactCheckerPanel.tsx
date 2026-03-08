/**
 * FactCheckerPanel - Fact checking display
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import React, { useMemo, useCallback, useState } from 'react';
import type { FactCheck } from '../types';

type FactCheckFilter = 'All' | 'True' | 'False' | 'Misleading' | 'Unverified';

export interface FactCheckerPanelProps {
  factChecks: FactCheck[];
  onExport: () => void;
  onClear: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const FactCheckerPanel: React.FC<FactCheckerPanelProps> = React.memo(({
  factChecks,
  onExport,
  onClear,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [factCheckFilter, setFactCheckFilter] = useState<FactCheckFilter>('All');
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());

  // Memoized filtered and sorted fact checks - AUDIT FIX
  const sortedFactChecks = useMemo(() => {
    const filtered = factChecks.filter(claim =>
      factCheckFilter === 'All' || claim.verdict === factCheckFilter
    );
    return [...filtered].sort((a, b) => {
      const aPinned = pinnedClaims.has(a.id);
      const bPinned = pinnedClaims.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
  }, [factChecks, factCheckFilter, pinnedClaims]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFactCheckFilter(e.target.value as FactCheckFilter);
  }, []);

  const togglePinClaim = useCallback((id: string) => {
    setPinnedClaims(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const getVerdictClass = useCallback((verdict: string) => {
    switch (verdict) {
      case 'True': return 'verdict-true';
      case 'False': return 'verdict-false';
      case 'Misleading': return 'verdict-misleading';
      default: return 'verdict-unverified';
    }
  }, []);

  return (
    <div className="section">
      <div className="section-header-row">
        <div className="section-header">✓ FACT CHECKER</div>
        <button className="collapse-btn" onClick={onToggleCollapse}>
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="fact-check-tools">
            <select
              className="fact-filter-select"
              value={factCheckFilter}
              onChange={handleFilterChange}
              aria-label="Filter fact checks"
            >
              <option value="All">All</option>
              <option value="True">True</option>
              <option value="False">False</option>
              <option value="Misleading">Misleading</option>
              <option value="Unverified">Unverified</option>
            </select>
            <button
              className="tool-btn"
              onClick={onExport}
              title="Export fact checks"
              aria-label="Export fact checks"
            >
              📥
            </button>
            <button
              className="tool-btn"
              onClick={onClear}
              title="Clear all"
              aria-label="Clear fact checks"
            >
              🗑️
            </button>
          </div>

          <div className="fact-check-feed">
            {sortedFactChecks.map((claim) => {
              const verdictClass = getVerdictClass(claim.verdict);
              const isPinned = pinnedClaims.has(claim.id);
              return (
                <div key={claim.id} className="fact-check-item">
                  <div className="fact-check-header">
                    <span className={`verdict-badge ${verdictClass}`}>
                      {claim.verdict}
                    </span>
                    <span className="confidence-badge">{claim.confidence}%</span>
                    <button
                      className={`pin-button ${isPinned ? 'pinned' : ''}`}
                      onClick={() => togglePinClaim(claim.id)}
                      aria-label={isPinned ? 'Unpin claim' : 'Pin claim'}
                    >
                      {isPinned ? '📌' : '📍'}
                    </button>
                  </div>
                  <div className="fact-check-claim">{claim.claim}</div>
                  <div className="fact-check-reason">{claim.reason}</div>
                  <div className="fact-check-time">
                    {new Date(claim.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});

FactCheckerPanel.displayName = 'FactCheckerPanel';

export default FactCheckerPanel;
