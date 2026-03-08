import type { CSSProperties } from 'react';

export const styles: Record<string, CSSProperties> = {
  audioMeter: {
    marginBottom: '12px'
  },
  meterLabel: {
    fontSize: '10px',
    color: '#888',
    letterSpacing: '1px',
    marginBottom: '6px'
  },
  meterBar: {
    width: '100%',
    height: '8px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  meterFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.1s'
  },
  settingsOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  settingsPanel: {
    background:
      'linear-gradient(135deg, rgba(138, 43, 226, 0.15), rgba(75, 0, 130, 0.1))',
    border: '1px solid rgba(138, 43, 226, 0.3)',
    borderRadius: '16px',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    width: '600px',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  settingsPanelHeader: {
    padding: '20px',
    borderBottom: '1px solid rgba(138, 43, 226, 0.3)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  settingsTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 700,
    letterSpacing: '2px',
    color: '#00ddff'
  },
  settingsCloseBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: '24px',
    cursor: 'pointer',
    width: '32px',
    height: '32px'
  },
  modalContent: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px'
  },
  modalInput: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(138, 43, 226, 0.3)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none'
  },
  modalButtonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  modalCancelButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #666',
    color: '#ccc',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  modalConfirmButton: {
    padding: '8px 16px',
    backgroundColor: '#8a2be2',
    border: 'none',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 700
  }
};
