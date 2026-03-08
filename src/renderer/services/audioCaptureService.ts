/**
 * AUDIO CAPTURE SERVICE - Renderer (GUTTED)
 *
 * Microphone capture is now handled by NativeAudioManager (ffmpeg) in the main process.
 * This stub preserves the interface so existing UI code doesn't break.
 */

export class AudioCaptureService {
  constructor() {
    console.log('[AudioCaptureService] Gutted — mic capture handled by NativeAudioManager');
  }

  public async start(_deviceId?: string): Promise<void> {
    // No-op: NativeAudioManager captures mic in main process
  }

  public stop(): void {
    // No-op
  }

  public isCapturing(): boolean {
    return false;
  }
}
