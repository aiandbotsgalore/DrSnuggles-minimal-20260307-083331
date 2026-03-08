import { EventEmitter } from "events";
import { spawn, ChildProcess, execSync } from "child_process";

/**
 * NativeAudioManager
 *
 * Handles audio I/O directly using system binaries (ffmpeg/ffplay)
 * to bypass Electron/Browser overhead.
 *
 * Zero-resampling design:
 *   Input:  ffmpeg captures at 16kHz s16le → emits raw Buffer (ready for Gemini base64)
 *   Output: ffplay plays at 24kHz s16le   ← accepts raw Buffer (from Gemini base64 decode)
 */
export class NativeAudioManager extends EventEmitter {
  private ffmpeg: ChildProcess | null = null;
  private ffplay: ChildProcess | null = null;
  private isRecording: boolean = false;
  private inputMuted: boolean = false;
  private outputMuted: boolean = false;
  private outputVolume: number = 1;
  private dataChunkCount: number = 0;

  // Config — formats match Gemini's native formats (zero resampling)
  private readonly SAMPLE_RATE_IN = 16000; // Gemini expects 16kHz s16le
  private readonly SAMPLE_RATE_OUT = 24000; // Gemini outputs 24kHz s16le
  private readonly CHANNELS = 1;

  // Echo suppression: mute mic input while outputting audio to prevent
  // Snuggles from hearing (and responding to) his own voice.
  // This works at the audio layer — independent of Gemini client state.
  private echoSuppressed: boolean = false;
  private echoSuppressionTimer: NodeJS.Timeout | null = null;
  // Virtual playback clock: tracks when ffplay will finish playing all queued audio.
  // Chunks arrive in bursts but represent seconds of audio — we must track the
  // cumulative duration, not just the last chunk.
  private playbackEndTime: number = 0;
  // Safety tail after all audio finishes playing through speakers.
  private readonly ECHO_TAIL_MS = 2000;

  constructor() {
    super();
  }

  /**
   * Parse ffmpeg dshow output into a list of audio device names.
   * Supports both legacy "DirectShow audio devices" section output
   * and newer lines formatted as: "Device Name" (audio).
   */
  private parseDshowAudioDevices(output: string): string[] {
    const devices: string[] = [];
    const lines = output.split("\n");
    let inAudio = false;

    for (const line of lines) {
      const quoted = line.match(/"([^"]+)"/);
      if (!quoted || quoted[1].startsWith("@device")) {
        continue;
      }

      if (line.includes("DirectShow audio devices")) {
        inAudio = true;
        continue;
      }
      if (inAudio && line.includes("DirectShow video devices")) {
        break;
      }

      const isAudioTagged = /\(audio\)/i.test(line);
      if (inAudio || isAudioTagged) {
        devices.push(quoted[1]);
      }
    }

    return devices;
  }

  /**
   * List available DirectShow audio input devices (Windows).
   * Returns device names parsed from ffmpeg output.
   */
  public listInputDevices(): string[] {
    try {
      // ffmpeg prints device list to stderr and exits with code 1
      const output = execSync(
        "ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1",
        { encoding: "utf-8", timeout: 5000 },
      ).toString();
      return this.parseDshowAudioDevices(output);
    } catch (error: any) {
      // ffmpeg -list_devices exits with code 1, but output is in stdout/stderr
      const output =
        error?.stdout || error?.stderr || error?.output?.join("") || "";
      return this.parseDshowAudioDevices(String(output));
    }
  }

  /**
   * Start microphone capture at 16kHz s16le (Gemini's native input format).
   * Emits 'data' events with raw Buffer chunks ready for base64 encoding.
   */
  public start(): void {
    if (this.isRecording) return;

    // Discover available audio devices for diagnostics
    const devices = this.listInputDevices();
    console.log(
      `[NativeAudio] Available input devices: ${JSON.stringify(devices)}`,
    );

    // Device selection strategy (in priority order):
    //  1. Any Voicemeeter device — user has deliberately routed audio through it
    //  2. A device labelled microphone/mic (skipped if Voicemeeter present)
    //  3. "audio=default" — lets Windows honour the system default recording device
    //     (e.g. Voicemeeter Out B1 set as default in Sound Settings)
    //
    // NOTE: Never fall back to devices[0]; that grabs hardware mics (e.g. Realtek)
    // even when the user has configured a Voicemeeter device as the system default.
    const inputFormat = "dshow";
    let inputDevice = "audio=default";
    if (devices.length > 0) {
      const voicemeeterDevice = devices.find((d) => /voicemeeter/i.test(d));
      const micDevice =
        devices.find((d) => /^microphone\b/i.test(d)) ||
        devices.find((d) => /\b(microphone|mic)\b/i.test(d));

      const preferredDevice = voicemeeterDevice ?? micDevice ?? null;

      if (preferredDevice) {
        inputDevice = `audio=${preferredDevice}`;
        console.log(
          `[NativeAudio] Using detected input device: "${preferredDevice}"${
            voicemeeterDevice ? " (Voicemeeter — highest priority)" : ""
          }`,
        );
      } else {
        // No Voicemeeter or mic-labelled device found — fall back to Windows default
        console.log(
          '[NativeAudio] No preferred device found — using "audio=default" (Windows system default recording device)',
        );
      }
    } else {
      console.warn(
        '[NativeAudio] No audio devices found! Using "audio=default" (Windows system default recording device)',
      );
    }

    console.log(
      `[NativeAudio] Starting microphone capture (16kHz s16le) on ${inputDevice}...`,
    );

    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      inputFormat,
      "-i",
      inputDevice,
      "-ac",
      `${this.CHANNELS}`,
      "-ar",
      `${this.SAMPLE_RATE_IN}`,
      "-f",
      "s16le", // 16-bit signed little-endian PCM
      "pipe:1",
    ];

    this.ffmpeg = spawn("ffmpeg", args);
    this.dataChunkCount = 0;

    if (this.ffmpeg.stdout) {
      this.ffmpeg.stdout.on("data", (chunk: Buffer) => {
        this.dataChunkCount++;
        // Log first few chunks + periodic health check
        if (this.dataChunkCount <= 3) {
          console.log(
            `[NativeAudio] 🎤 Mic data chunk #${this.dataChunkCount}: ${chunk.length} bytes`,
          );
        } else if (this.dataChunkCount === 50) {
          console.log(
            `[NativeAudio] ✅ Mic capture healthy — 50 chunks received`,
          );
        }

        if (this.inputMuted || this.echoSuppressed) {
          return;
        }
        // Emit raw Buffer — caller base64-encodes directly for Gemini
        this.emit("data", chunk);
      });
    }

    if (this.ffmpeg.stderr) {
      this.ffmpeg.stderr.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg.length > 0) {
          console.warn(`[NativeAudio] ffmpeg stderr: ${msg}`);
        }
      });
    }

    this.ffmpeg.on("error", (err) => {
      console.error(`[NativeAudio] ffmpeg spawn error:`, err);
      this.isRecording = false;
    });

    this.ffmpeg.on("close", (code) => {
      console.log(
        `[NativeAudio] ffmpeg exited with code ${code} (captured ${this.dataChunkCount} chunks)`,
      );
      this.isRecording = false;
      if (code !== 0 && code !== null) {
        console.error(
          `[NativeAudio] ❌ ffmpeg exited abnormally! Mic capture failed.`,
        );
      }
    });

    this.isRecording = true;

    // Initialize output immediately too
    this.startOutput();
  }

  // Backpressure state
  private isBackpressured: boolean = false;

  /**
   * Start ffplay process for output at 24kHz s16le (Gemini's native output format).
   */
  private startOutput(): void {
    if (this.ffplay) return;

    console.log("[NativeAudio] Starting speaker output (24kHz s16le)...");

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le", // 16-bit signed little-endian PCM
      "-ar",
      `${this.SAMPLE_RATE_OUT}`,
      "-ac",
      `${this.CHANNELS}`,
      "-probesize",
      "32", // Minimal probe for raw PCM
      "-fflags",
      "nobuffer", // No input buffering
      "-flags",
      "low_delay", // Low-latency decoding
      "-nodisp", // No window
      "-", // Read from stdin
    ];

    this.ffplay = spawn("ffplay", args);
    this.isBackpressured = false;

    this.ffplay.on("close", (code) => {
      console.log(`[NativeAudio] ffplay exited with code ${code}`);
      this.ffplay = null;
      this.isBackpressured = false;
    });

    this.ffplay.stdin?.on("error", (err) => {
      if ((err as any).code !== "EPIPE") {
        console.error("[NativeAudio] ffplay stdin error:", err);
      }
    });

    // Handle backpressure drain
    this.ffplay.stdin?.on("drain", () => {
      this.isBackpressured = false;
      this.processQueue();
    });
  }

  /**
   * Generates and plays a 1kHz test tone for 1 second.
   * Useful for verifying the output path without external audio files.
   */
  public playTestTone(): void {
    console.log("[NativeAudio] 🔊 Generating 1kHz test tone...");
    const durationSeconds = 1;
    const numSamples = this.SAMPLE_RATE_OUT * durationSeconds;
    const frequency = 1000;
    const volume = 0.3;
    const buffer = Buffer.alloc(numSamples * 2); // 16-bit PCM = 2 bytes per sample

    for (let i = 0; i < numSamples; i++) {
      const sampleValue = Math.sin(
        (2 * Math.PI * frequency * i) / this.SAMPLE_RATE_OUT,
      );
      const s16le = Math.floor(sampleValue * volume * 32767);
      buffer.writeInt16LE(s16le, i * 2);
    }

    this.play(buffer);
  }

  // Queue for backpressure handling
  private backpressureQueue: Buffer[] = [];
  private isWriting: boolean = false;

  /**
   * Play audio by writing raw s16le bytes to ffplay stdin.
   * Accepts Buffer (raw 24kHz s16le from Gemini base64 decode).
   */
  private playChunkCount: number = 0;

  public play(chunk: Buffer): void {
    this.playChunkCount++;
    if (this.outputMuted) {
      return;
    }
    if (!this.ffplay || !this.ffplay.stdin) {
      console.log(
        `[NativeAudio] 🔊 play() called but no ffplay process — starting output...`,
      );
      this.startOutput();
    }

    if (this.ffplay && this.ffplay.stdin) {
      if (this.playChunkCount <= 3 || this.playChunkCount === 50) {
        console.log(
          `[NativeAudio] 🔊 Play chunk #${this.playChunkCount}: ${chunk.length} bytes, queue: ${this.backpressureQueue.length}, backpressured: ${this.isBackpressured}`,
        );
      }

      // Echo suppression: mute mic while ffplay is outputting audio.
      // Track a virtual playback clock — chunks arrive in bursts but
      // represent seconds of cumulative audio through the speaker.
      // 24kHz, 16-bit mono = 48000 bytes/sec
      const chunkDurationMs = (chunk.length / 48000) * 1000;
      const now = Date.now();
      this.playbackEndTime =
        Math.max(now, this.playbackEndTime) + chunkDurationMs;

      if (!this.echoSuppressed) {
        this.echoSuppressed = true;
        console.log("[NativeAudio] Echo suppression ON (output started)");
      }
      if (this.echoSuppressionTimer) {
        clearTimeout(this.echoSuppressionTimer);
      }
      // Suppress mic until all queued audio finishes playing + tail
      const suppressionMs =
        this.playbackEndTime - now + this.ECHO_TAIL_MS;
      this.echoSuppressionTimer = setTimeout(() => {
        this.echoSuppressed = false;
        this.echoSuppressionTimer = null;
        this.playbackEndTime = 0;
        console.log("[NativeAudio] Echo suppression OFF (playback + tail done)");
      }, suppressionMs);

      // Copy the buffer to avoid aliasing issues
      const bufferCopy = Buffer.allocUnsafe(chunk.length);
      chunk.copy(bufferCopy);

      // Software gain for native output volume control.
      if (this.outputVolume !== 1) {
        for (let i = 0; i + 1 < bufferCopy.length; i += 2) {
          const sample = bufferCopy.readInt16LE(i);
          const scaled = Math.max(
            -32768,
            Math.min(32767, Math.round(sample * this.outputVolume)),
          );
          bufferCopy.writeInt16LE(scaled, i);
        }
      }

      this.backpressureQueue.push(bufferCopy);
      this.processQueue();
    } else {
      console.error(
        `[NativeAudio] ❌ play() failed: ffplay=${!!this.ffplay}, stdin=${!!this.ffplay?.stdin}`,
      );
    }
  }

  private processQueue(): void {
    if (
      this.isWriting ||
      !this.ffplay ||
      !this.ffplay.stdin ||
      this.backpressureQueue.length === 0
    )
      return;

    // If backpressured, stop writing until 'drain'
    if (this.isBackpressured) return;

    this.isWriting = true;

    while (this.backpressureQueue.length > 0) {
      const buffer = this.backpressureQueue[0];

      try {
        const canContinue = this.ffplay.stdin.write(buffer);
        this.backpressureQueue.shift();

        if (!canContinue) {
          this.isBackpressured = true;
          break;
        }
      } catch (error) {
        console.error("[NativeAudio] Write error:", error);
        this.backpressureQueue.shift();
      }
    }

    this.isWriting = false;
  }

  public stop(): void {
    if (this.ffmpeg) {
      this.ffmpeg.kill();
      this.ffmpeg = null;
    }
    if (this.ffplay) {
      this.ffplay.stdin?.end();
      this.ffplay.kill();
      this.ffplay = null;
    }
    if (this.echoSuppressionTimer) {
      clearTimeout(this.echoSuppressionTimer);
      this.echoSuppressionTimer = null;
    }
    this.echoSuppressed = false;
    this.isRecording = false;
    this.isBackpressured = false;
  }

  public setInputMuted(muted: boolean): void {
    this.inputMuted = Boolean(muted);
    console.log(`[NativeAudio] Input mute: ${this.inputMuted}`);
  }

  /**
   * Force-clear echo suppression (e.g. when user deliberately interrupts).
   * Allows mic input to resume immediately without waiting for the tail timer.
   */
  public clearEchoSuppression(): void {
    if (this.echoSuppressed) {
      this.echoSuppressed = false;
      if (this.echoSuppressionTimer) {
        clearTimeout(this.echoSuppressionTimer);
        this.echoSuppressionTimer = null;
      }
      console.log("[NativeAudio] Echo suppression cleared (interruption)");
    }
  }

  public setOutputVolume(volume: number): void {
    this.outputVolume = Math.max(0, Math.min(2, Number(volume) || 0));
    console.log(`[NativeAudio] Output volume: ${this.outputVolume.toFixed(2)}`);
  }

  public setOutputMuted(muted: boolean): void {
    const nextMuted = Boolean(muted);
    if (nextMuted === this.outputMuted) {
      return;
    }

    this.outputMuted = nextMuted;
    if (this.outputMuted) {
      this.backpressureQueue = [];
      if (this.ffplay) {
        this.ffplay.stdin?.end();
        this.ffplay.kill();
        this.ffplay = null;
      }
      this.isBackpressured = false;
      this.isWriting = false;
      this.playbackEndTime = 0;
      this.clearEchoSuppression();
    }

    console.log(`[NativeAudio] Output mute: ${this.outputMuted}`);
  }
}
