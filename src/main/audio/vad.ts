/**
 * VOICE ACTIVITY DETECTION (VAD) - December 2025
 *
 * Detects when user is speaking to optimize audio transmission
 *
 * Strategy:
 * 1. Only send audio when user is speaking (saves bandwidth & cost)
 * 2. Immediately stop sending when Gemini starts responding (true turn-taking)
 * 3. Use RMS + zero-crossing rate for robust detection
 */

/**
 * Configuration for Voice Activity Detection.
 */
import EventEmitter from 'eventemitter3';
import { calculateRMS } from '../../shared/audioUtils';

/**
 * Configuration for Voice Activity Detection.
 */
export interface VADConfig {
  /** RMS threshold for voice detection (0-1, default: 0.01) */
  rmsThreshold: number;

  /** Zero-crossing rate threshold (Hz, default: 50) */
  zcrThreshold: number;

  /** Minimum consecutive frames to trigger speech (default: 3) */
  minSpeechFrames: number;

  /** Minimum consecutive frames to trigger silence (default: 10) */
  minSilenceFrames: number;

  /** Sample rate (Hz) */
  sampleRate: number;

  /** Enable adaptive threshold based on noise floor estimation (default: true) */
  adaptiveThreshold?: boolean;

  /** Smoothing factor for noise floor estimation (0.01-0.1, default: 0.05) */
  noiseFloorAlpha?: number;

  /** Ratio between offset/onset thresholds for hysteresis (default: 0.6) */
  hysteresisRatio?: number;
}

/**
 * Events emitted by VoiceActivityDetector.
 */
export interface VADEvents {
  speech: () => void;
  silence: () => void;
}

/**
 * Voice Activity Detector (VAD).
 *
 * Analyzes audio frames to detect speech based on Root Mean Square (RMS) energy
 * and Zero-Crossing Rate (ZCR). It manages the state of user speech and
 * respects turn-taking by suppressing user audio when Gemini is speaking.
 */
export class VoiceActivityDetector extends EventEmitter<VADEvents> {
  private config: VADConfig;
  private speechFrameCount: number = 0;
  private silenceFrameCount: number = 0;
  private isSpeaking: boolean = false;
  private isGeminiSpeaking: boolean = false;

  // Adaptive noise floor estimation
  private noiseFloor: number = 0.005;
  private readonly MIN_NOISE_FLOOR = 0.001;
  private readonly MAX_NOISE_FLOOR = 0.05;

  /**
   * Initializes the VoiceActivityDetector.
   *
   * @param {Partial<VADConfig>} [config] - Optional configuration overrides.
   */
  constructor(config?: Partial<VADConfig>) {
    super();
    this.config = {
      rmsThreshold: config?.rmsThreshold ?? 0.01, // More sensitive default (was 0.05)
      zcrThreshold: config?.zcrThreshold ?? 50,
      minSpeechFrames: config?.minSpeechFrames ?? 3, // Faster start
      minSilenceFrames: config?.minSilenceFrames ?? 15, // Faster turnaround (approx 300ms)
      sampleRate: config?.sampleRate ?? 48000,
      adaptiveThreshold: config?.adaptiveThreshold ?? true,
      noiseFloorAlpha: config?.noiseFloorAlpha ?? 0.05,
      hysteresisRatio: config?.hysteresisRatio ?? 0.6
    };

    console.log('[VAD] Initialized with config:', this.config);
  }

  /**
   * Process audio frame and determine if speech is present.
   *
   * Analyzes the frame's RMS and ZCR. Updates the internal state machine
   * to decide if the user is speaking or silent.
   *
   * @param {Float32Array} audioData - Float32Array audio samples.
   * @returns {boolean} true if user is speaking and should send audio.
   */
  public process(audioData: Float32Array): boolean {
    // Never send audio if Gemini is speaking (true turn-taking)
    if (this.isGeminiSpeaking) {
      this.reset();
      return false;
    }

    // Calculate voice activity features
    const rms = calculateRMS(audioData);
    const zcr = this.calculateZCR(audioData);

    // Get effective threshold with hysteresis
    const threshold = this.getEffectiveThreshold();
    const onsetThreshold = threshold;
    const offsetThreshold = threshold * (this.config.hysteresisRatio ?? 0.6);

    // Determine if current frame contains speech (hysteresis: harder to start, easier to stop)
    const hasVoiceActivity = this.isSpeaking
      ? (rms > offsetThreshold && zcr > this.config.zcrThreshold)  // Easier to maintain speech
      : (rms > onsetThreshold && zcr > this.config.zcrThreshold);  // Harder to trigger speech

    // Update noise floor during silence
    if (!hasVoiceActivity) {
      this.updateNoiseFloor(rms);
    }

    if (hasVoiceActivity) {
      this.speechFrameCount++;
      this.silenceFrameCount = 0;

      // Trigger speech after minimum consecutive frames
      if (this.speechFrameCount >= this.config.minSpeechFrames) {
        if (!this.isSpeaking) {
          console.log(`[VAD] 🎤 Speech detected (RMS: ${rms.toFixed(4)}, ZCR: ${zcr.toFixed(0)})`);
          this.emit('speech');
        }
        this.isSpeaking = true;
      }
    } else {
      this.silenceFrameCount++;
      this.speechFrameCount = 0;

      // Trigger silence after minimum consecutive frames
      if (this.silenceFrameCount >= this.config.minSilenceFrames) {
        if (this.isSpeaking) {
          console.log('[VAD] 🔇 Silence detected');
          this.emit('silence');
        }
        this.isSpeaking = false;
      }
    }

    return this.isSpeaking;
  }

  /**
   * Signal that Gemini has started speaking.
   * This immediately stops user audio transmission (turn-taking).
   *
   * @param {boolean} speaking - True if Gemini is speaking.
   */
  public setGeminiSpeaking(speaking: boolean): void {
    if (speaking !== this.isGeminiSpeaking) {
      console.log(`[VAD] 🤖 Gemini ${speaking ? 'started' : 'stopped'} speaking`);
      this.isGeminiSpeaking = speaking;

      if (speaking) {
        this.reset();
      }
    }
  }

  /**
   * Check if user is currently speaking.
   * @returns {boolean} True if user is speaking and Gemini is not.
   */
  public isSpeechActive(): boolean {
    return this.isSpeaking && !this.isGeminiSpeaking;
  }

  /**
   * Reset VAD state.
   * Clears counters and resets speaking state.
   */
  public reset(): void {
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.isSpeaking = false;
  }



  /**
   * Calculate Zero-Crossing Rate (ZCR).
   * Higher ZCR indicates voice frequency content.
   *
   * @param {Float32Array} samples - Audio samples.
   * @returns {number} The ZCR in Hz.
   */
  private calculateZCR(samples: Float32Array): number {
    let crossings = 0;

    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) ||
        (samples[i] < 0 && samples[i - 1] >= 0)) {
        crossings++;
      }
    }

    // Convert to Hz
    const duration = samples.length / this.config.sampleRate;
    return crossings / duration;
  }

  /**
   * Get effective RMS threshold, adapting to noise floor if enabled.
   * @returns {number} The effective threshold for voice detection.
   */
  private getEffectiveThreshold(): number {
    if (!this.config.adaptiveThreshold) {
      return this.config.rmsThreshold;
    }
    // Threshold is noise floor * 3, but at least the configured minimum
    return Math.max(this.config.rmsThreshold, this.noiseFloor * 3);
  }

  /**
   * Update noise floor estimate during confirmed silence.
   * Uses exponential moving average for smooth adaptation.
   * @param {number} rms - Current RMS value.
   */
  private updateNoiseFloor(rms: number): void {
    if (!this.isSpeaking && this.config.adaptiveThreshold) {
      const alpha = this.config.noiseFloorAlpha ?? 0.05;
      this.noiseFloor = this.noiseFloor * (1 - alpha) + rms * alpha;
      // Clamp to reasonable range
      this.noiseFloor = Math.max(
        this.MIN_NOISE_FLOOR,
        Math.min(this.MAX_NOISE_FLOOR, this.noiseFloor)
      );
    }
  }

  /**
   * Get current noise floor estimate for debugging.
   * @returns {number} The current noise floor estimate.
   */
  public getNoiseFloor(): number {
    return this.noiseFloor;
  }

  /**
   * Update configuration at runtime.
   * @param {Partial<VADConfig>} config - New configuration values.
   */
  public updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[VAD] Config updated:', this.config);
  }

  /**
   * Get current configuration.
   * @returns {VADConfig} The current configuration.
   */
  public getConfig(): VADConfig {
    return { ...this.config };
  }

  /**
   * Get current state for debugging.
   * @returns {object} Current VAD state (speaking flags, counters, and noise floor).
   */
  public getState(): {
    isSpeaking: boolean;
    isGeminiSpeaking: boolean;
    speechFrameCount: number;
    silenceFrameCount: number;
    noiseFloor: number;
    effectiveThreshold: number;
  } {
    return {
      isSpeaking: this.isSpeaking,
      isGeminiSpeaking: this.isGeminiSpeaking,
      speechFrameCount: this.speechFrameCount,
      silenceFrameCount: this.silenceFrameCount,
      noiseFloor: this.noiseFloor,
      effectiveThreshold: this.getEffectiveThreshold()
    };
  }
}
