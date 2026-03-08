/**
 * ShortcutsModal - Keyboard shortcuts overlay
 * Toggled with Ctrl+/ or Ctrl+?
 */

import React from 'react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl+K', action: 'Search transcript' },
  { keys: 'Ctrl+M', action: 'Toggle mute' },
  { keys: 'Ctrl+I', action: 'Interrupt' },
  { keys: 'Ctrl+Enter', action: 'Send context' },
  { keys: 'Escape', action: 'Interrupt (when live)' },
  { keys: 'Ctrl+/', action: 'Show shortcuts' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel shortcut-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel-header">
          <h2 className="settings-title">KEYBOARD SHORTCUTS</h2>
          <button className="settings-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="shortcuts-content">
          <table className="shortcuts-table">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys} className="shortcut-row-data">
                  <td className="shortcut-key-cell">
                    <kbd className="kbd">{shortcut.keys}</kbd>
                  </td>
                  <td className="shortcut-action-cell">
                    {shortcut.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

ShortcutsModal.displayName = 'ShortcutsModal';
export default ShortcutsModal;
