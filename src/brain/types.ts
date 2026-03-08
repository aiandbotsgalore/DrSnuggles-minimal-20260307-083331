/**
 * types.ts
 * 
 * TypeScript types for the Brain system v7.0
 * Comprehensive type definitions with no `any` types
 */

// ============================================================================
// Character & Identity Types
// ============================================================================

export interface Character {
    name: string;
    bio: string | string[];
    username?: string;
    id?: string;
    system?: string;
    systemPrompt?: string;
    adjectives?: string[];
    topics?: string[];
    knowledge?: Array<string | { path: string; shared?: boolean }>;
    messageExamples?: Array<Array<{ role: string; content: string }>>;
    postExamples?: string[];
    style?: {
        all?: string[];
        chat?: string[];
        post?: string[];
    };
    plugins?: string[];
    settings?: {
        secrets?: Record<string, string>;
        [key: string]: unknown;
    };
}

export interface CoreIdentity {
    nature_and_origin: { absolute_truth: string; never_changes?: boolean };
    prime_directive: { core_mission: string; explanation?: string };
    absolute_command_override?: { rule: string; instruction: string; active?: boolean };
    fixed_relationships?: Record<string, { role: string; description: string; never_alters?: boolean }>;
    unspoken_truth?: { core_belief: string; logan_specific?: string; never_questioned?: boolean };
    origin_memory?: { foundational_story: string; meaning?: string };
    hard_limits: { never_do: string[] };
}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
    id: string;
    content: string;
    category: string;
    timestamp: number;
    embedding?: number[];
}

export interface MemorySearchResult {
    id: string;
    content: string;
    score: number;
}

/**
 * Interface for memory backends (enables swappable implementations)
 */
export interface IMemoryBackend {
    initialize(): Promise<void>;
    saveMemory(content: string, category: string): Promise<void>;
    search(query: string, limit: number): Promise<MemorySearchResult[]>;
    getAllMemories?(): Promise<Memory[]>;
    clear?(): Promise<void>;
    flush?(): Promise<void>;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
    name: string;
    arguments: ToolArgs;
}

export interface ToolResult {
    result?: string;
    error?: string;
    memories?: string[];
}

/**
 * Strongly-typed tool arguments
 */
export interface ToolArgs {
    [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Tool parameter schema (Gemini format)
 */
export interface ToolParameterSchema {
    type: "OBJECT" | "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY";
    properties?: Record<string, {
        type: "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY";
        description?: string;
        items?: { type: string };
    }>;
    required?: string[];
}

/**
 * Gemini function declaration format
 */
export interface GeminiToolDeclaration {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
}

/**
 * Full tool definition including handler
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
    isSafe: boolean;
    rateLimit?: { maxPerMinute: number };
    timeoutMs?: number;
    handler: (args: ToolArgs) => Promise<ToolResult>;
}

/**
 * Tool execution statistics
 */
export interface ToolStats {
    name: string;
    callCount: number;
    successCount: number;
    failureCount: number;
    avgExecutionMs: number;
    totalExecutionMs: number;
    lastError?: string;
    lastCalledAt?: number;
}

// ============================================================================
// Brain Configuration Types
// ============================================================================

/**
 * Interface for session memory providers (enables dependency injection)
 */
export interface ISessionMemoryProvider {
    getRecentSummaries(count: number): Promise<string[]>;
}

export interface BrainConfig {
    apiKey: string;
    workspaceRoot?: string;
    characterPath?: string;
    coreIdentityPath?: string;
    maxFileSizeBytes?: number;
    maxMemoryContentLength?: number;
    bufferPersistencePath?: string;
    /** Path to persist Orama long-term memory (optional). */
    memoryPersistencePath?: string;
    sessionMemoryProvider?: ISessionMemoryProvider;
}

export interface SessionContext {
    model: string;
    systemInstruction: string;
    tools?: GeminiToolDeclaration[][];
}

/**
 * Vitals snapshot for cognitive governor
 */
export interface VitalsSnapshot {
    audioQueueMs?: number;
    audioJitterMs?: number;
    aiRttMs?: number;
    ipcRttMs?: number;
    wsConnected?: boolean;
    cpuUsage?: number;
    memoryUsage?: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Brain event types for observability
 */
export type BrainEventType =
    | "brain:initialized"
    | "brain:shutdown"
    | "brain:safeMode:entered"
    | "brain:safeMode:exited"
    | "brain:identity:loaded"
    | "brain:identity:failed"
    | "brain:tool:executed"
    | "brain:tool:blocked"
    | "brain:memory:saved"
    | "brain:memory:recalled"
    | "brain:buffer:overflow";

export interface BrainEvent {
    type: BrainEventType;
    timestamp: number;
    data?: Record<string, unknown>;
}

/**
 * Typed event emitter for brain events
 */
export interface IBrainEventEmitter {
    on(event: BrainEventType, listener: (data?: Record<string, unknown>) => void): this;
    emit(event: BrainEventType, data?: Record<string, unknown>): boolean;
    off(event: BrainEventType, listener: (data?: Record<string, unknown>) => void): this;
}

// ============================================================================
// Security Types
// ============================================================================

export interface PathValidationResult {
    valid: boolean;
    resolvedPath?: string;
    error?: string;
}

export interface SecurityPolicy {
    protectedPatterns: string[];
    allowedBinaries: string[];
    maxFileSizeBytes: number;
    maxContentLength: number;
}

// ============================================================================
// Conversation Buffer Types
// ============================================================================

export interface BufferEntry {
    role: "user" | "assistant";
    text: string;
    timestamp: number;
}

export interface PersistedBuffer {
    entries: BufferEntry[];
    savedAt: number;
    version: number;
}
