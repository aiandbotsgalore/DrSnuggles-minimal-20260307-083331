/**
 * OPTIMIZED AUDIO RESAMPLER - December 2025
 *
 * Blazingly fast linear interpolation resampler for Gemini Live API
 *
 * Upstream: 48kHz (system) → 16kHz (Gemini requirement)
 * Downstream: 24kHz (Gemini output) → 48kHz (system playback)
 *
 * Format compliance:
 * - Upstream: Float32Array → Int16Array → base64 PCM16
 * - Downstream: base64 PCM16 → Int16Array → Float32Array
 *
 * Optimizations:
 * - Buffer pooling to avoid GC pauses during streaming
 */

import { PERFORMANCE_CONFIG } from '../config/performance.config';

/**
 * Buffer pool for reusing typed arrays to reduce GC pressure.
 * Pre-allocates buffers and recycles them instead of creating new ones.
 */
class BufferPool<T extends Float32Array | Int16Array> {
  private pool: T[] = [];
  private readonly maxSize: number;
  private readonly createBuffer: (size: number) => T;
  private hits = 0;
  private misses = 0;

  constructor(
    maxSize: number,
    createBuffer: (size: number) => T
  ) {
    this.maxSize = maxSize;
    this.createBuffer = createBuffer;
  }

  /**
   * Get a buffer of at least the requested size.
   * Returns a pooled buffer if available, otherwise creates a new one.
   */
  acquire(size: number): T {
    // Find a buffer that's large enough
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].length >= size) {
        this.hits++;
        const buffer = this.pool.splice(i, 1)[0];
        // CRITICAL: Use .slice() NOT .subarray() when buffer is larger.
        // .subarray() returns an aliased view sharing the same ArrayBuffer.
        // If the parent buffer is later returned to the pool and reused,
        // both the caller's data and the new user's data overlap — causing
        // audio corruption (garbled chunks, pops, clicks).
        // .slice() creates a NEW ArrayBuffer with its own memory.
        return buffer.length === size ? buffer : buffer.slice(0, size) as T;
      }
    }

    // No suitable buffer found, create new one
    this.misses++;
    return this.createBuffer(size);
  }

  /**
   * Return a buffer to the pool for reuse.
   */
  release(buffer: T): void {
    // Don't pool subarrays (they share underlying buffer)
    if (buffer.byteOffset !== 0) return;

    if (this.pool.length < this.maxSize) {
      this.pool.push(buffer);
    }
    // If pool is full, let the buffer be GC'd
  }

  /**
   * Get pool statistics for debugging.
   */
  getStats(): { poolSize: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      poolSize: this.pool.length,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : 'N/A'
    };
  }

  /**
   * Clear the pool and reset statistics.
   */
  clear(): void {
    this.pool = [];
    this.hits = 0;
    this.misses = 0;
  }
}

// Global buffer pools - shared across all resampler instances
const POOL_SIZE = PERFORMANCE_CONFIG.MEMORY.AUDIO_BUFFER_POOL_SIZE;

export const float32Pool = new BufferPool<Float32Array>(
  POOL_SIZE,
  (size) => new Float32Array(size)
);

export const int16Pool = new BufferPool<Int16Array>(
  POOL_SIZE,
  (size) => new Int16Array(size)
);

/**
 * Handles high-performance audio resampling using linear interpolation.
 */
export class AudioResampler {
  private ratio: number;

  /**
   * Create resampler with source and target rates.
   *
   * @param {number} sourceRate - Input sample rate (Hz).
   * @param {number} targetRate - Output sample rate (Hz).
   */
  constructor(
    private sourceRate: number,
    private targetRate: number
  ) {
    this.ratio = targetRate / sourceRate;
    console.log(`[Resampler] ${sourceRate}Hz → ${targetRate}Hz (ratio: ${this.ratio.toFixed(4)})`);
  }

  /**
   * Resample audio using linear interpolation.
   * Ultra-fast, minimal CPU overhead.
   * Uses buffer pooling to reduce GC pressure.
   *
   * @param {Float32Array} input - Input audio samples.
   * @param {boolean} usePool - Whether to use buffer pooling (default: true).
   * @returns {Float32Array} Resampled audio samples.
   */
  public resample(input: Float32Array, usePool: boolean = true): Float32Array {
    if (this.sourceRate === this.targetRate) {
      return input; // No-op if rates match
    }

    const outputLength = Math.floor(input.length * this.ratio);
    const output = usePool
      ? float32Pool.acquire(outputLength)
      : new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / this.ratio;
      const floor = Math.floor(srcIndex);
      const ceil = Math.min(floor + 1, input.length - 1);
      const fraction = srcIndex - floor;

      // Linear interpolation
      output[i] = input[floor] * (1 - fraction) + input[ceil] * fraction;
    }

    return output;
  }

  /**
   * Release a buffer back to the pool when done with it.
   * Call this when you're finished using a resampled buffer.
   *
   * @param {Float32Array} buffer - Buffer to release.
   */
  public static releaseFloat32(buffer: Float32Array): void {
    float32Pool.release(buffer);
  }

  /**
   * Release an Int16 buffer back to the pool.
   *
   * @param {Int16Array} buffer - Buffer to release.
   */
  public static releaseInt16(buffer: Int16Array): void {
    int16Pool.release(buffer);
  }

  /**
   * Get buffer pool statistics for debugging.
   */
  public static getPoolStats(): { float32: ReturnType<BufferPool<Float32Array>['getStats']>; int16: ReturnType<BufferPool<Int16Array>['getStats']> } {
    return {
      float32: float32Pool.getStats(),
      int16: int16Pool.getStats()
    };
  }

  /**
   * Convert Float32 PCM to Int16 PCM.
   * Required format for Gemini API.
   * Uses buffer pooling to reduce GC pressure.
   *
   * @param {Float32Array} float32 - Input float audio data.
   * @param {boolean} usePool - Whether to use buffer pooling (default: true).
   * @returns {Int16Array} Converted 16-bit integer audio data.
   */
  public static float32ToInt16(float32: Float32Array, usePool: boolean = true): Int16Array {
    const int16 = usePool
      ? int16Pool.acquire(float32.length)
      : new Int16Array(float32.length);

    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }

    return int16;
  }

  /**
   * Convert Int16 PCM to Float32 PCM.
   * For audio playback.
   * Uses buffer pooling to reduce GC pressure.
   *
   * @param {Int16Array} int16 - Input 16-bit integer audio data.
   * @param {boolean} usePool - Whether to use buffer pooling (default: true).
   * @returns {Float32Array} Converted float audio data.
   */
  public static int16ToFloat32(int16: Int16Array, usePool: boolean = true): Float32Array {
    const float32 = usePool
      ? float32Pool.acquire(int16.length)
      : new Float32Array(int16.length);

    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    return float32;
  }

  /**
   * UPSTREAM PIPELINE: System audio → Gemini.
   * 48kHz Float32 → 16kHz Int16 → base64.
   *
   * @param {Float32Array} systemAudio - Input audio buffer.
   * @param {AudioResampler} resampler - Resampler instance to use.
   * @returns {string} Base64 encoded audio string.
   */
  public static prepareForGemini(systemAudio: Float32Array, resampler: AudioResampler): string {
    // 1. Resample: 48kHz → 16kHz
    const resampled = resampler.resample(systemAudio);

    // 2. Convert: Float32 → Int16
    const int16 = AudioResampler.float32ToInt16(resampled);

    // Release the resampled buffer back to pool (we're done with it)
    AudioResampler.releaseFloat32(resampled);

    // 3. Encode: Int16 → base64
    const buffer = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
    const base64 = buffer.toString('base64');

    // Release the int16 buffer back to pool
    AudioResampler.releaseInt16(int16);

    return base64;
  }

  /**
   * DOWNSTREAM PIPELINE: Gemini → System audio.
   * base64 → 24kHz Int16 → Float32 → 48kHz Float32.
   *
   * @param {string} base64PCM - Base64 encoded audio string from Gemini.
   * @param {AudioResampler} resampler - Resampler instance to use.
   * @returns {Float32Array} System-ready audio buffer.
   */
  public static prepareForPlayback(base64PCM: string, resampler: AudioResampler): Float32Array {
    // 1. Decode: base64 → Buffer
    const buffer = Buffer.from(base64PCM, 'base64');

    // 2. Convert: Buffer → Int16Array
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);

    // 3. Convert: Int16 → Float32
    const float32 = AudioResampler.int16ToFloat32(int16);

    // 4. Resample: 24kHz → 48kHz
    const upsampled = resampler.resample(float32);

    // Release the intermediate float32 buffer (caller owns upsampled)
    AudioResampler.releaseFloat32(float32);

    return upsampled;
  }

  /**
   * Get the source sample rate.
   * @returns {number} Source sample rate in Hz.
   */
  public getSourceRate(): number {
    return this.sourceRate;
  }

  /**
   * Get the target sample rate.
   * @returns {number} Target sample rate in Hz.
   */
  public getTargetRate(): number {
    return this.targetRate;
  }

  /**
   * Get the resampling ratio.
   * @returns {number} Ratio of target rate to source rate.
   */
  public getRatio(): number {
    return this.ratio;
  }
}

/**
 * Pre-configured resampler instances for common conversion tasks.
 */
export class AudioResamplers {
  /** Upstream resampler: System (48kHz) → Gemini (16kHz). */
  public static readonly UPSTREAM = new AudioResampler(48000, 16000);

  /** Downstream resampler: Gemini (24kHz) → System (48kHz). */
  public static readonly DOWNSTREAM = new AudioResampler(24000, 48000);
}
