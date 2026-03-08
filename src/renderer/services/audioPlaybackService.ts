/**
 * AUDIO PLAYBACK SERVICE - Renderer (GUTTED)
 *
 * Audio playback is now handled by NativeAudioManager (ffplay) in the main process.
 * This stub preserves the interface so existing UI code doesn't break.
 */

export class AudioPlaybackService {
  private _audioContext: AudioContext | null = null;
  private _isActive: boolean = false;

  constructor() {
    console.log('[AudioPlaybackService] Gutted — speaker output handled by NativeAudioManager');
  }

  public get audioContext(): AudioContext | null {
    return this._audioContext;
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public setVolume(_volume: number): void {
    // No-op: volume handled by NativeAudioManager/system
  }

  public connectVisualizer(_analyser: AnalyserNode): void {
    // No-op
  }

  public start(): void {
    this._isActive = true;
    console.log('[AudioPlaybackService] start() called (no-op, playback via ffplay)');
  }

  public testTone(): void {
    console.log('[AudioPlaybackService] testTone() called (no-op in headless mode)');
  }

  public isPlaybackQueueEmpty(): boolean {
    return true;
  }

  public cancelPlayback(): void {
    // No-op
  }

  public stop(): void {
    this._isActive = false;
  }
}
