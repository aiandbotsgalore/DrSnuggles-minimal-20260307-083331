/**
 * Custom hook for managing audio capture and playback services.
 *
 * GUTTED: Audio I/O is handled by NativeAudioManager (ffmpeg/ffplay) in main process.
 * This hook preserves the interface so the UI doesn't break.
 */

import { useRef, useCallback } from "react";
import { AudioCaptureService } from "../../../services/audioCaptureService";
import { AudioPlaybackService } from "../../../services/audioPlaybackService";
import { ipc } from "../../../ipc";
import { IPC_CHANNELS } from "../../../../shared/types";

export interface UseAudioServicesReturn {
  audioCaptureService: React.MutableRefObject<AudioCaptureService | null>;
  audioPlaybackService: React.MutableRefObject<AudioPlaybackService | null>;
  startCapture: (deviceId?: string) => Promise<void>;
  stopCapture: () => void;
  setVolume: (volume: number) => void;
  testTone: () => void;
  isCapturing: () => boolean;
}

export function useAudioServices(): UseAudioServicesReturn {
  // Keep refs for interface compatibility but services are no-ops
  const audioCaptureService = useRef<AudioCaptureService | null>(
    new AudioCaptureService(),
  );
  const audioPlaybackService = useRef<AudioPlaybackService | null>(
    new AudioPlaybackService(),
  );

  const startCapture = useCallback(async (_deviceId?: string) => {
    // No-op: NativeAudioManager handles mic
  }, []);

  const stopCapture = useCallback(() => {
    // No-op
  }, []);

  const setVolume = useCallback((_volume: number) => {
    // No-op
  }, []);

  const testTone = useCallback(() => {
    console.log("[useAudioServices] Triggering native audio test tone...");
    ipc.send(IPC_CHANNELS.VOICE_TEST, { volume: 0.5 });
  }, []);

  const isCapturing = useCallback(() => false, []);

  return {
    audioCaptureService,
    audioPlaybackService,
    startCapture,
    stopCapture,
    setVolume,
    testTone,
    isCapturing,
  };
}
