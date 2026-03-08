import React, { useEffect, useState } from 'react';

import { ipc } from '../ipc';
import { IPC_CHANNELS, VolumeData } from '../../shared/types';
import { styles } from './styles';

export const AudioMeterWidget: React.FC = () => {
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    const unsubAudioLevel = ipc.on(IPC_CHANNELS.AUDIO_LEVEL, (_event: any, data: { level: number }) => {
      void _event;
      setAudioLevel(data.level);
    });
    const unsubVolume = ipc.on(IPC_CHANNELS.VOLUME_UPDATE, (_event: any, data: VolumeData) => {
      void _event;
      setAudioLevel(data?.input ?? 0);
    });

    return () => {
      unsubAudioLevel();
      unsubVolume();
    };
  }, []);

  return (
    <div style={styles.audioMeter}>
      <div style={styles.meterLabel}>INPUT LEVEL</div>
      <div style={styles.meterBar}>
        <div
          style={{
            ...styles.meterFill,
            width: `${audioLevel}%`,
            backgroundColor: audioLevel > 80 ? '#ff4444' : audioLevel > 50 ? '#ffaa00' : '#00ff88'
          }}
        />
      </div>
    </div>
  );
};
