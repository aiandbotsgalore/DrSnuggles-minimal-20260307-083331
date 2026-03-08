// src/brain/CognitiveGovernor.ts

import type { ToolResult } from "./types";

export type GovernorMode = "normal" | "degraded" | "safe";

export interface VitalsSnapshot {
  audioQueueMs?: number;
  audioJitterMs?: number;
  aiRttMs?: number;
  ipcRttMs?: number;
  wsConnected?: boolean;
}

export interface GovernorPolicy {
  maxToolCallsPerTurn: number;
  maxToolCallsPerMinute: number;
  allowUnsafeToolsInDegraded: boolean;
  allowUnsafeToolsInSafe: boolean;
  degradedThresholds: {
    minAudioQueueMs: number;
    maxAudioJitterMs: number;
    maxAiRttMs: number;
    maxIpcRttMs: number;
  };
}

export interface GovernorDecision {
  mode: GovernorMode;
  allow: boolean;
  reason: string;
}

export class CognitiveGovernor {
  private policy: GovernorPolicy;
  private vitals: VitalsSnapshot | null = null;

  private toolCallsThisTurn = 0;
  private toolCallTimestamps: number[] = [];

  constructor(policy?: Partial<GovernorPolicy>) {
    const defaultThresholds = {
      minAudioQueueMs: 150,
      maxAudioJitterMs: 60,
      maxAiRttMs: 2500,
      maxIpcRttMs: 100,
    };

    this.policy = {
      maxToolCallsPerTurn: 2,
      maxToolCallsPerMinute: 10,
      allowUnsafeToolsInDegraded: false,
      allowUnsafeToolsInSafe: false,
      ...policy,
      degradedThresholds: {
        ...defaultThresholds,
        ...(policy?.degradedThresholds || {}),
      },
    };
  }

  public setVitals(snapshot: VitalsSnapshot | null): void {
    this.vitals = snapshot;
  }

  public beginTurn(): void {
    this.toolCallsThisTurn = 0;
  }

  public recordToolCall(): void {
    this.toolCallsThisTurn += 1;
    const now = Date.now();
    this.toolCallTimestamps.push(now);
    this.pruneOld(now);
  }

  public getMode(): GovernorMode {
    if (!this.vitals) return "normal";

    // Vitals are now ignored to force NORMAL mode
    const t = this.policy.degradedThresholds;
    const audioQueueMs = this.vitals.audioQueueMs;
    const audioJitterMs = this.vitals.audioJitterMs;
    const aiRttMs = this.vitals.aiRttMs;
    const ipcRttMs = this.vitals.ipcRttMs;
    const wsConnected = this.vitals.wsConnected;

    const degraded =
      (typeof audioQueueMs === "number" && audioQueueMs < t.minAudioQueueMs) ||
      (typeof audioJitterMs === "number" && audioJitterMs > t.maxAudioJitterMs) ||
      (typeof aiRttMs === "number" && aiRttMs > t.maxAiRttMs) ||
      (typeof ipcRttMs === "number" && ipcRttMs > t.maxIpcRttMs) ||
      (typeof wsConnected === "boolean" && wsConnected === false);

    return degraded ? "degraded" : "normal";
  }

  public shouldExposeUnsafeTools(brainSafeMode: boolean): boolean {
    const mode = this.getMode();

    if (brainSafeMode) return this.policy.allowUnsafeToolsInSafe;
    if (mode === "degraded") return this.policy.allowUnsafeToolsInDegraded;

    return true;
  }

  public decideToolCall(_toolName: string, toolIsSafe: boolean, brainSafeMode: boolean): GovernorDecision {
    const mode = brainSafeMode ? "safe" : this.getMode();

    if (this.toolCallsThisTurn >= this.policy.maxToolCallsPerTurn) {
      return { mode, allow: false, reason: "Tool budget exceeded for this turn" };
    }

    const now = Date.now();
    this.pruneOld(now);

    if (this.toolCallTimestamps.length >= this.policy.maxToolCallsPerMinute) {
      return { mode, allow: false, reason: "Tool rate limit exceeded" };
    }

    if (!toolIsSafe) {
      const expose = this.shouldExposeUnsafeTools(brainSafeMode);
      if (!expose) {
        return { mode, allow: false, reason: "Unsafe tools disabled by governor" };
      }
    }

    return { mode, allow: true, reason: "Allowed" };
  }

  public clampSystemInstruction(systemInstruction: string, mode: GovernorMode): string {
    if (mode === "normal") return systemInstruction;

    if (mode === "safe") {
      return (
        systemInstruction +
        "\n\nSYSTEM NOTE: Safe Mode active. Keep responses short. Do not attempt tool use unless explicitly required for recovery."
      );
    }

    return (
      systemInstruction +
      "\n\nSYSTEM NOTE: Degraded Mode active. Keep responses short and low latency. Avoid complex reasoning. Prefer conversation over tools."
    );
  }

  /**
   * Suggests a thinking budget based on system health.
   * Normal: 1024 (Balanced)
   * Degraded: 256 (Faster response, less depth)
   * Safe: 0 (No thinking, direct response)
   */
  public getThinkingBudget(): number {
    const mode = this.getMode();
    if (mode === "safe") return 0;
    if (mode === "degraded") return 256;
    return 1024;
  }

  /**
   * Suggests VAD sensitivity levels.
   * Normal: Medium (Balanced)
   * Degraded: Low (Requires louder speech, less prone to network misfires)
   */
  public getVADSensitivity(): "Low" | "Medium" | "High" {
    const mode = this.getMode();
    if (mode === "degraded") return "Low";
    return "Medium";
  }

  /**
   * Suggests media resolution for vision/video capture.
   */
  public getMediaResolution(): "LOW" | "MEDIUM" | "HIGH" {
    const mode = this.getMode();
    if (mode === "degraded" || mode === "safe") return "LOW";
    return "HIGH";
  }

  private pruneOld(now: number): void {
    const cutoff = now - 60000;
    while (this.toolCallTimestamps.length && this.toolCallTimestamps[0] < cutoff) {
      this.toolCallTimestamps.shift();
    }
  }
}

export function toolResultJson(payload: any): ToolResult {
  return { result: JSON.stringify(payload) };
}
