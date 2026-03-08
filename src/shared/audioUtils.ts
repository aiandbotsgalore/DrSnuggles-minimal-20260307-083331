/**
 * Shared Audio Utilities
 */

/**
 * Calculates the Root Mean Square (RMS) of a Float32Array of audio samples.
 * Used for voice activity detection and audio level visualization.
 * 
 * @param samples - The audio samples to analyze
 * @returns The RMS value (0.0 to 1.0)
 */
export function calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
}
