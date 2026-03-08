// src/brain/DrSnugglesBrain.ts
// Hardened Bare Metal Brain v7.0 - Feb 2026 Ultimate Edition
// Full Type Safety + Event Emitter + Analytics + Modular Architecture

import { EventEmitter } from "events";
import path from "path";
import fs from "fs/promises";

import { OramaMemory } from "./memory/OramaIntegration";
import { ToolManager, ToolError } from "./tools/ToolManager";
import { SecurityViolation } from "./security/PathGuard";
import { CognitiveGovernor } from "./CognitiveGovernor";
import { logger } from "../main/utils/StructuredLogger";

import type {
  Character,
  CoreIdentity,
  ToolResult,
  BrainConfig,
  SessionContext,
  VitalsSnapshot,
  BufferEntry,
  PersistedBuffer,
  BrainEventType,
  ToolStats,
  GeminiToolDeclaration,
  ISessionMemoryProvider,
} from "./types";

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base brain error with programmatic code
 */
export class BrainError extends Error {
  constructor(
    message: string,
    public readonly code: string = "BRAIN_GENERAL_FAILURE"
  ) {
    super(`[Brain:${code}] ${message}`);
    this.name = "BrainError";
  }
}

// Re-export for backwards compatibility
export { SecurityViolation, ToolError };

// ============================================================================
// DrSnugglesBrain v7.0
// ============================================================================

/**
 * DrSnugglesBrain: Production-Grade AI Brain
 * 
 * Features:
 * - Event emitter for observability
 * - Memoized tool manifests with analytics
 * - Parallel initialization
 * - Structured error codes
 * - Buffer persistence
 * - Context token estimation
 * - Full type safety (no `any`)
 */
export class DrSnugglesBrain extends EventEmitter {
  private config: BrainConfig;
  private apiKey: string;
  private memory: OramaMemory;
  private toolManager: ToolManager;
  private governor: CognitiveGovernor;
  private workspaceRoot: string;

  private character: Character | null = null;
  private coreIdentity: CoreIdentity | null = null;
  private systemInstruction: string = "";
  private safeMode: boolean = true;
  private latestVitals: VitalsSnapshot | null = null;
  private conversationBuffer: BufferEntry[] = [];
  private maxBufferSize: number = 15;
  private isInitialized: boolean = false;
  private bufferPersistencePath: string | null = null;
  private sessionMemoryProvider: ISessionMemoryProvider | null = null;

  constructor(config: BrainConfig) {
    super();
    this.config = config;
    this.apiKey = config.apiKey;
    this.memory = new OramaMemory({ persistencePath: config.memoryPersistencePath });
    this.workspaceRoot = this.resolveWorkspaceRoot(config.workspaceRoot);
    this.toolManager = new ToolManager(this.workspaceRoot, this.memory, {
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxMemoryContentLength: config.maxMemoryContentLength,
    });
    this.governor = new CognitiveGovernor();
    this.bufferPersistencePath = config.bufferPersistencePath || null;
    this.sessionMemoryProvider = config.sessionMemoryProvider || null;
  }

  // =========================================================================
  // Initialization & Shutdown
  // =========================================================================

  /**
   * Initialize the brain with parallel loading
   */
  public async initialize(override?: Partial<BrainConfig>): Promise<void> {
    // Guard against redundant initialization
    if (this.isInitialized && !override) {
      return;
    }

    if (override) {
      this.config = { ...this.config, ...override };
      if (override.apiKey) this.apiKey = override.apiKey;
      if (Object.prototype.hasOwnProperty.call(override, "memoryPersistencePath")) {
        this.memory.setPersistencePath(override.memoryPersistencePath || null);
      }
      if (override.workspaceRoot) {
        this.workspaceRoot = this.resolveWorkspaceRoot(override.workspaceRoot);
        this.toolManager = new ToolManager(this.workspaceRoot, this.memory, {
          maxFileSizeBytes: this.config.maxFileSizeBytes,
          maxMemoryContentLength: this.config.maxMemoryContentLength,
        });
      }
    }

    try {
      // Parallel initialization for reduced boot time
      await Promise.all([
        this.memory.initialize(),
        this.loadIdentity(),
        this.restoreBuffer(),
      ]);

      this.isInitialized = true;
      logger.info("[Brain] v7.0 System Core initialized successfully.");
      this.emitEvent("brain:initialized");
    } catch (e: unknown) {
      this.safeMode = true;
      this.systemInstruction = "CRITICAL: Brain Identity Corrupted. Operating in Safe Mode.";
      logger.error(`[Brain] Initialization Failure: ${e instanceof Error ? e.message : e}`);
      this.emitEvent("brain:safeMode:entered", { reason: "initialization_failure" });
    }
  }

  /**
   * Alias for backwards compatibility
   */
  public async initializeMemory(): Promise<void> {
    await this.initialize();
  }

  /**
   * Graceful shutdown with cleanup
   */
  public async shutdown(): Promise<void> {
    logger.info("[Brain] Graceful shutdown sequence initiated.");

    try {
      // 1. Persist buffer before shutdown
      await this.persistBuffer();

      // 2. Flush any pending memory operations
      if (this.memory.flush) {
        await this.memory.flush();
      }

      // 3. Clear runtime state
      this.conversationBuffer = [];
      this.latestVitals = null;

      // 4. Emit shutdown event
      this.emitEvent("brain:shutdown");

      this.isInitialized = false;
      logger.info("[Brain] Shutdown complete.");
    } catch (e: unknown) {
      logger.error(`[Brain] Shutdown error: ${e instanceof Error ? e.message : e}`);
    }
  }

  // =========================================================================
  // Vitals & Governor
  // =========================================================================

  /**
   * Update system vitals for cognitive governor
   */
  public updateVitals(snapshot: VitalsSnapshot): void {
    this.latestVitals = snapshot;
    this.governor.setVitals(snapshot);
  }

  // =========================================================================
  // Identity Loading
  // =========================================================================

  private resolveWorkspaceRoot(provided?: string): string {
    if (provided) return path.resolve(provided);
    return path.resolve(process.cwd());
  }

  private async loadIdentity(): Promise<void> {
    const charPath = this.config.characterPath
      ? path.resolve(this.config.characterPath)
      : path.join(this.workspaceRoot, "dr_snuggles.character.json");

    const corePath = this.config.coreIdentityPath
      ? path.resolve(this.config.coreIdentityPath)
      : path.join(this.workspaceRoot, "core_identity.json");

    try {
      const [charData, coreData] = await Promise.all([
        fs.readFile(charPath, "utf-8"),
        fs.readFile(corePath, "utf-8").catch(() => null),
      ]);

      this.character = JSON.parse(charData) as Character;
      if (coreData) {
        this.coreIdentity = JSON.parse(coreData) as CoreIdentity;
      }

      this.safeMode = false;
      this.systemInstruction = this.buildSystemPrompt();
      this.emitEvent("brain:identity:loaded", { character: this.character.name });
    } catch (e: unknown) {
      this.safeMode = true;
      this.character = {
        name: "Safe Mode Agent",
        bio: ["Emergency Recovery Mode"],
        style: {},
      };
      this.systemInstruction = "SYSTEM ERROR: Identity corrupted. Be a helpful assistant until recovery.";
      this.emitEvent("brain:identity:failed", { error: e instanceof Error ? e.message : "unknown" });
      throw new BrainError(
        `Identity load failed: ${e instanceof Error ? e.message : e}`,
        "IDENTITY_LOAD_FAILURE"
      );
    }
  }

  private buildSystemPrompt(): string {
    if (!this.character) return "";

    const builder: string[] = [];

    if (this.coreIdentity) {
      const limits = this.coreIdentity.hard_limits?.never_do || [];
      const loganDesc = this.coreIdentity.fixed_relationships?.logan?.description || "Operator";

      builder.push("\n=== IMMUTABLE CORE IDENTITY (ABSOLUTE TRUTH) ===");
      builder.push(`[Nature]: ${this.coreIdentity.nature_and_origin.absolute_truth}`);
      builder.push(`[Mission]: ${this.coreIdentity.prime_directive.core_mission}`);
      builder.push(
        `[ABSOLUTE COMMAND OVERRIDE]: ${this.coreIdentity.absolute_command_override?.rule || "Obey Logan"}`
      );
      builder.push(
        `  -> ${this.coreIdentity.absolute_command_override?.instruction || "Total obedience."}`
      );
      builder.push(`[Logan's Role]: ${loganDesc}`);
      builder.push(`[Hard Limits]:`);
      limits.forEach(l => builder.push(`- ${l}`));
      builder.push("================================================\n");
    }

    builder.push(`NAME: ${this.character.name}`);

    const bio = Array.isArray(this.character.bio)
      ? this.character.bio.join("\n")
      : (this.character.bio || "");
    builder.push(`\nBIO:\n${bio}`);

    const styleAll = this.character.style?.all?.join("\n") || "";
    const styleChat = this.character.style?.chat?.join("\n") || "";
    builder.push(`\nSTYLE:\n${styleAll}\n${styleChat}`);

    const prompt = this.character.systemPrompt || "";
    builder.push(`\n${prompt}`);

    return builder.join("\n");
  }

  // =========================================================================
  // Public API
  // =========================================================================

  public getApiKey(): string {
    return this.apiKey;
  }
  public getCharacterName(): string {
    return this.character?.name || "Dr. Snuggles";
  }

  /**
   * Get tool manifest for Gemini session
   */
  public getToolManifest(): GeminiToolDeclaration[][] {
    const exposeUnsafe = this.governor.shouldExposeUnsafeTools(this.safeMode);
    const effectiveSafeMode = this.safeMode || !exposeUnsafe;
    return this.toolManager.getManifest(effectiveSafeMode);
  }

  /**
   * Get dynamic capability suggestions based on governor vitals
   */
  public getGovernanceSuggestions() {
    return {
      mode: this.governor.getMode(),
      thinkingBudget: this.governor.getThinkingBudget(),
      vadSensitivity: this.governor.getVADSensitivity(),
      mediaResolution: this.governor.getMediaResolution(),
    };
  }

  /**
   * Execute a tool with governor oversight
   */
  public async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const toolIsSafe = this.toolManager.isToolSafe(toolName);

    const decision = this.governor.decideToolCall(toolName, toolIsSafe, this.safeMode);
    if (!decision.allow) {
      logger.warn(`[Governor] Tool execution blocked: ${toolName} (${decision.reason})`);
      this.emitEvent("brain:tool:blocked", { tool: toolName, reason: decision.reason });
      return { error: `[Governor:${decision.mode}] ${decision.reason}` };
    }

    this.governor.recordToolCall();

    // Validate run_command structure
    if (toolName === "run_command" && typeof args?.command === "string") {
      return {
        error: "Validation Error: run_command requires explicit { binary, params } object structure.",
      };
    }

    const result = await this.toolManager.execute(
      toolName,
      args as Record<string, string | number | boolean | string[]>,
      this.safeMode
    );
    this.emitEvent("brain:tool:executed", {
      tool: toolName,
      success: !result.error,
    });

    return result;
  }

  /**
   * Get tool execution statistics
   */
  public getToolStats(): ToolStats[] {
    return this.toolManager.getStats();
  }

  /**
   * Prepare session context with memory enhancement
   */
  public async prepareSessionContext(userContext?: string): Promise<SessionContext> {
    // Defensively wrap memory search
    let memories: Array<{ content: string }> = [];
    try {
      memories = await this.memory.search(userContext || "current conversation context", 5);
      this.emitEvent("brain:memory:recalled", { count: memories.length });
    } catch (e) {
      logger.error("[Brain] Memory search failed during context prep.");
    }

    // Fetch session summaries for cross-session memory
    let sessionSummaries: string[] = [];
    if (this.sessionMemoryProvider) {
      try {
        sessionSummaries = await this.sessionMemoryProvider.getRecentSummaries(5);
        logger.info(`[Brain] Retrieved ${sessionSummaries.length} session summaries for context.`);
      } catch (e) {
        logger.error("[Brain] Session memory retrieval failed during context prep.");
      }
    }

    const builder: string[] = [];

    const mode = this.safeMode ? "safe" : this.governor.getMode();
    builder.push(this.governor.clampSystemInstruction(this.systemInstruction, mode as "normal" | "degraded" | "safe"));

    // Inject session summaries (cross-session memory)
    if (sessionSummaries.length > 0) {
      builder.push("\nPREVIOUS SESSION MEMORIES:");
      sessionSummaries.forEach((s, i) => builder.push(`[Session ${i + 1}]: ${s}`));
    }

    if (this.conversationBuffer.length > 0) {
      builder.push("\nRECENT CONVERSATION HISTORY:");
      this.conversationBuffer.forEach(m => builder.push(`${m.role}: ${m.text}`));
    }

    if (memories.length > 0) {
      builder.push("\nRELEVANT MEMORIES:");
      memories.forEach(m => builder.push(`- ${m.content}`));
    }

    if (this.latestVitals) {
      builder.push(`\nVITALS:\n${JSON.stringify(this.latestVitals)}`);
    }

    return {
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      systemInstruction: builder.join("\n"),
      tools: this.getToolManifest(),
    };
  }

  /**
   * Estimate context token count (~4 chars per token)
   */
  public estimateContextTokens(): number {
    const systemLen = this.systemInstruction.length;
    const bufferLen = this.conversationBuffer.reduce((sum, m) => sum + m.text.length, 0);
    const vitalsLen = this.latestVitals ? JSON.stringify(this.latestVitals).length : 0;

    return Math.ceil((systemLen + bufferLen + vitalsLen) / 4);
  }

  // =========================================================================
  // Conversation Buffer
  // =========================================================================

  /**
   * Add message to conversation buffer
   */
  public addToBuffer(role: "user" | "assistant", text: string): void {
    this.conversationBuffer.push({
      role,
      text,
      timestamp: Date.now(),
    });

    // Lossless long-term memory: persist every turn (best-effort, async)
    void this.memory.saveConversationTurn({ role, text });

    if (this.conversationBuffer.length > this.maxBufferSize) {
      const removed = this.conversationBuffer.shift();
      if (removed?.role === "user" && removed.text.length > 20) {
        this.memory.saveMemory(removed.text, "conversation_archive")
          .catch(e => logger.error(`[Brain] Buffer archival failed: ${e instanceof Error ? e.message : e}`));
      }
      this.emitEvent("brain:buffer:overflow", { archivedText: removed?.text?.substring(0, 50) });
    }
  }

  public getRecentContext(): string {
    return this.conversationBuffer.map(m => `${m.role}: ${m.text}`).join("\n");
  }

  public clearBuffer(): void {
    this.conversationBuffer = [];
  }

  public setMaxBufferSize(n: number): void {
    this.maxBufferSize = Math.max(1, Math.min(100, n));
  }

  public updateSystemInstruction(instruction: string): void {
    this.systemInstruction = instruction;
  }

  // =========================================================================
  // Buffer Persistence
  // =========================================================================

  private async persistBuffer(): Promise<void> {
    if (!this.bufferPersistencePath || this.conversationBuffer.length === 0) {
      return;
    }

    try {
      const data: PersistedBuffer = {
        entries: this.conversationBuffer,
        savedAt: Date.now(),
        version: 1,
      };
      await fs.writeFile(this.bufferPersistencePath, JSON.stringify(data, null, 2), "utf-8");
      logger.info(`[Brain] Buffer persisted: ${this.conversationBuffer.length} entries`);
    } catch (e) {
      logger.error(`[Brain] Buffer persistence failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async restoreBuffer(): Promise<void> {
    if (!this.bufferPersistencePath) {
      return;
    }

    try {
      const content = await fs.readFile(this.bufferPersistencePath, "utf-8");
      const data = JSON.parse(content) as PersistedBuffer;

      if (data.version === 1 && Array.isArray(data.entries)) {
        // Only restore if less than 1 hour old
        if (Date.now() - data.savedAt < 3600000) {
          this.conversationBuffer = data.entries;
          logger.info(`[Brain] Buffer restored: ${data.entries.length} entries`);
        }
      }
    } catch {
      // File doesn't exist or is corrupted - that's fine
    }
  }

  // =========================================================================
  // Event Emitter Helpers
  // =========================================================================

  private emitEvent(event: BrainEventType, data?: Record<string, unknown>): void {
    this.emit(event, { type: event, timestamp: Date.now(), data });
  }

  /**
   * Subscribe to brain events (typed wrapper)
   */
  public onBrainEvent(
    event: BrainEventType,
    listener: (data?: Record<string, unknown>) => void
  ): this {
    return this.on(event, listener);
  }

  // =========================================================================
  // Dynamic Tool Configuration
  // =========================================================================

  /**
   * Add a binary to the command allowlist
   */
  public allowBinary(binary: string): void {
    this.toolManager.allowBinary(binary);
  }

  /**
   * Remove a binary from the command allowlist
   */
  public revokeBinary(binary: string): void {
    this.toolManager.revokeBinary(binary);
  }
}
