/**
 * ToolManager.ts
 * 
 * Tool registry with execution, analytics, and rate limiting
 */

import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { PathGuard, SecurityViolation } from "../security/PathGuard";
import type {
    ToolDefinition,
    ToolResult,
    ToolArgs,
    ToolStats,
    GeminiToolDeclaration,
    IMemoryBackend,
} from "../types";

const execFileAsync = promisify(execFile);

/**
 * Tool execution error with context
 */
export class ToolError extends Error {
    public readonly code = "TOOL_EXECUTION_ERROR";
    public readonly toolName: string;

    constructor(toolName: string, error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        super(`[Tool:${toolName}] ${msg}`);
        this.name = "ToolError";
        this.toolName = toolName;
    }
}

/**
 * Default configuration
 */
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB
const DEFAULT_MAX_MEMORY_CONTENT = 10000; // 10k chars

/**
 * ToolManager: Memoized Registry with Analytics
 * 
 * Features:
 * - Tool registration and manifest generation
 * - Memoized manifests with cache invalidation
 * - Per-tool execution statistics
 * - Timeout wrapper for all executions
 * - Rate limiting support
 */
export class ToolManager {
    private registry = new Map<string, ToolDefinition>();
    private stats = new Map<string, ToolStats>();
    private rateLimitState = new Map<string, number[]>(); // timestamps

    private pathGuard: PathGuard;
    private memory: IMemoryBackend;

    // Memoized manifests
    private cachedManifestSafe: GeminiToolDeclaration[][] | null = null;
    private cachedManifestUnsafe: GeminiToolDeclaration[][] | null = null;

    // Configuration
    private maxFileSizeBytes: number;
    private maxMemoryContentLength: number;

    // Dynamic binary allowlist
    private allowedBinaries: Set<string>;

    constructor(
        workspaceRoot: string,
        memory: IMemoryBackend,
        options?: {
            maxFileSizeBytes?: number;
            maxMemoryContentLength?: number;
            additionalBinaries?: string[];
        }
    ) {
        this.pathGuard = new PathGuard(workspaceRoot);
        this.memory = memory;
        this.maxFileSizeBytes = options?.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE;
        this.maxMemoryContentLength = options?.maxMemoryContentLength || DEFAULT_MAX_MEMORY_CONTENT;

        // Platform-specific defaults + any additions
        const defaultBinaries = process.platform === "win32"
            ? ["git", "node", "npm", "npx"]
            : ["git", "node", "npm", "npx", "ls", "echo", "cat", "grep"];

        this.allowedBinaries = new Set([
            ...defaultBinaries,
            ...(options?.additionalBinaries || [])
        ]);

        this.registerCoreTools();
    }

    /**
     * Invalidate cached manifests
     */
    public invalidateCache(): void {
        this.cachedManifestSafe = null;
        this.cachedManifestUnsafe = null;
    }

    /**
     * Register a new tool
     */
    public register(tool: ToolDefinition): void {
        this.registry.set(tool.name, tool);
        this.stats.set(tool.name, {
            name: tool.name,
            callCount: 0,
            successCount: 0,
            failureCount: 0,
            avgExecutionMs: 0,
            totalExecutionMs: 0,
        });
        this.invalidateCache();
    }

    /**
     * Get tool manifest for Gemini (safe or all tools)
     */
    public getManifest(safeMode: boolean): GeminiToolDeclaration[][] {
        if (safeMode && this.cachedManifestSafe) return this.cachedManifestSafe;
        if (!safeMode && this.cachedManifestUnsafe) return this.cachedManifestUnsafe;

        const declarations: GeminiToolDeclaration[] = [];
        for (const tool of this.registry.values()) {
            if (safeMode && !tool.isSafe) continue;
            declarations.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            });
        }

        const manifest = [{ functionDeclarations: declarations }] as unknown as GeminiToolDeclaration[][];

        if (safeMode) this.cachedManifestSafe = manifest;
        else this.cachedManifestUnsafe = manifest;

        return manifest;
    }

    /**
     * Execute a tool with timeout, rate limiting, and stats tracking
     */
    public async execute(
        name: string,
        args: ToolArgs,
        safeMode: boolean
    ): Promise<ToolResult> {
        const tool = this.registry.get(name);
        const stats = this.stats.get(name);

        if (!tool) {
            return { error: `Tool Error: Definition for '${name}' not found.` };
        }

        if (safeMode && !tool.isSafe) {
            return { error: `Security Restriction: '${name}' is disabled in safe mode.` };
        }

        // Rate limiting check
        if (tool.rateLimit) {
            if (!this.checkRateLimit(name, tool.rateLimit.maxPerMinute)) {
                return { error: `Rate limit exceeded for tool '${name}'. Try again later.` };
            }
        }

        const startTime = Date.now();
        const timeoutMs = tool.timeoutMs || DEFAULT_TIMEOUT_MS;

        try {
            const result = await this.executeWithTimeout(
                () => tool.handler(args),
                timeoutMs
            );

            // Update stats on success
            if (stats) {
                stats.callCount++;
                stats.successCount++;
                const execTime = Date.now() - startTime;
                stats.totalExecutionMs += execTime;
                stats.avgExecutionMs = stats.totalExecutionMs / stats.callCount;
                stats.lastCalledAt = Date.now();
            }

            return result;
        } catch (error: unknown) {
            // Update stats on failure
            if (stats) {
                stats.callCount++;
                stats.failureCount++;
                stats.lastError = error instanceof Error ? error.message : String(error);
                stats.lastCalledAt = Date.now();
            }

            if (error instanceof SecurityViolation) {
                return { error: error.message };
            }

            const toolErr = new ToolError(name, error);
            return { error: toolErr.message };
        }
    }

    /**
     * Get statistics for all tools
     */
    public getStats(): ToolStats[] {
        return Array.from(this.stats.values());
    }

    /**
     * Get stats for a specific tool
     */
    public getToolStats(name: string): ToolStats | undefined {
        return this.stats.get(name);
    }

    /**
     * Check if a tool is safe
     */
    public isToolSafe(name: string): boolean {
        return this.registry.get(name)?.isSafe ?? false;
    }

    /**
     * Add a binary to the allowlist
     */
    public allowBinary(binary: string): void {
        this.allowedBinaries.add(binary);
    }

    /**
     * Remove a binary from the allowlist
     */
    public revokeBinary(binary: string): void {
        this.allowedBinaries.delete(binary);
    }

    /**
     * Get the PathGuard instance
     */
    public getPathGuard(): PathGuard {
        return this.pathGuard;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Execute with timeout
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number
    ): Promise<T> {
        return Promise.race([
            fn(),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
                    timeoutMs
                )
            ),
        ]);
    }

    /**
     * Check and update rate limit
     */
    private checkRateLimit(toolName: string, maxPerMinute: number): boolean {
        const now = Date.now();
        const cutoff = now - 60000;

        let timestamps = this.rateLimitState.get(toolName) || [];
        timestamps = timestamps.filter(t => t > cutoff);

        if (timestamps.length >= maxPerMinute) {
            return false;
        }

        timestamps.push(now);
        this.rateLimitState.set(toolName, timestamps);
        return true;
    }

    /**
     * Register core tools
     */
    private registerCoreTools(): void {
        // save_memory
        this.register({
            name: "save_memory",
            description: "Persist important facts or narrative shifts to long-term memory.",
            isSafe: true,
            parameters: {
                type: "OBJECT",
                properties: {
                    fact: { type: "STRING", description: "The fact to remember" },
                    category: { type: "STRING", description: "Category for organization" },
                },
                required: ["fact"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const fact = String(args.fact || "");
                const category = String(args.category || "general");

                // Content length validation
                if (fact.length > this.maxMemoryContentLength) {
                    return {
                        error: `Content too long. Maximum ${this.maxMemoryContentLength} characters allowed.`,
                    };
                }

                if (fact.length < 3) {
                    return { error: "Fact must be at least 3 characters." };
                }

                await this.memory.saveMemory(fact, category);
                return { result: "Fact successfully integrated into long-term memory." };
            },
        });

        // recall_memory
        this.register({
            name: "recall_memory",
            description: "Query long-term memory for past facts and context.",
            isSafe: true,
            parameters: {
                type: "OBJECT",
                properties: {
                    query: { type: "STRING", description: "Search query" },
                    limit: { type: "NUMBER", description: "Max results (1-20)" },
                },
                required: ["query"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const query = String(args.query || "");
                const limit = typeof args.limit === "number"
                    ? Math.max(1, Math.min(20, args.limit))
                    : 5;

                const results = await this.memory.search(query, limit);
                return {
                    result: JSON.stringify({
                        count: results.length,
                        memories: results.map(r => r.content),
                    }),
                };
            },
        });

        // read_file
        this.register({
            name: "read_file",
            description: "Read contents of a workspace file via relative path.",
            isSafe: true,
            parameters: {
                type: "OBJECT",
                properties: {
                    path: { type: "STRING", description: "Relative path to file" },
                },
                required: ["path"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const filePath = String(args.path || "");
                const safePath = this.pathGuard.validate(filePath);

                // Check file size before reading
                const stat = await fs.stat(safePath);
                if (stat.size > this.maxFileSizeBytes) {
                    return {
                        error: `File too large (${stat.size} bytes). Maximum ${this.maxFileSizeBytes} bytes allowed.`,
                    };
                }

                const content = await fs.readFile(safePath, "utf-8");
                return { result: content };
            },
        });

        // file_stats
        this.register({
            name: "file_stats",
            description: "Get file metadata without reading content (size, modified time).",
            isSafe: true,
            parameters: {
                type: "OBJECT",
                properties: {
                    path: { type: "STRING", description: "Relative path to file" },
                },
                required: ["path"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const filePath = String(args.path || "");
                const safePath = this.pathGuard.validate(filePath);

                const stat = await fs.stat(safePath);
                return {
                    result: JSON.stringify({
                        size: stat.size,
                        isDirectory: stat.isDirectory(),
                        isFile: stat.isFile(),
                        modified: stat.mtime.toISOString(),
                        created: stat.birthtime.toISOString(),
                    }),
                };
            },
        });

        // list_dir
        this.register({
            name: "list_dir",
            description: "List directory contents for workspace navigation.",
            isSafe: true,
            parameters: {
                type: "OBJECT",
                properties: {
                    path: { type: "STRING", description: "Relative path to directory" },
                },
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const target = String(args.path || ".").trim() || ".";
                const safePath = this.pathGuard.validate(target);

                const entries = await fs.readdir(safePath, { withFileTypes: true });
                const output = entries
                    .map(e => (e.isDirectory() ? `[DIR] ${e.name}` : `      ${e.name}`))
                    .join("\n");

                return { result: output || "(empty directory)" };
            },
        });

        // write_file
        this.register({
            name: "write_file",
            description: "Create or overwrite a file in the workspace.",
            isSafe: false,
            parameters: {
                type: "OBJECT",
                properties: {
                    path: { type: "STRING", description: "Relative path to file" },
                    content: { type: "STRING", description: "Content to write" },
                },
                required: ["path", "content"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const filePath = String(args.path || "");
                const content = String(args.content || "");

                const safePath = this.pathGuard.validateForWrite(filePath);
                await fs.mkdir(path.dirname(safePath), { recursive: true });
                await fs.writeFile(safePath, content, "utf-8");

                return { result: `File successfully written to ${filePath}` };
            },
        });

        // append_file (NEW)
        this.register({
            name: "append_file",
            description: "Append content to an existing file (non-destructive).",
            isSafe: false,
            parameters: {
                type: "OBJECT",
                properties: {
                    path: { type: "STRING", description: "Relative path to file" },
                    content: { type: "STRING", description: "Content to append" },
                },
                required: ["path", "content"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const filePath = String(args.path || "");
                const content = String(args.content || "");

                const safePath = this.pathGuard.validateForWrite(filePath);
                await fs.appendFile(safePath, content, "utf-8");

                return { result: `Content appended to ${filePath}` };
            },
        });

        // search_files (NEW)
        this.register({
            name: "search_files",
            description: "Search file contents using text pattern (grep-like).",
            isSafe: true,
            timeoutMs: 10000, // Shorter timeout for search
            parameters: {
                type: "OBJECT",
                properties: {
                    pattern: { type: "STRING", description: "Text pattern to search" },
                    directory: { type: "STRING", description: "Directory to search in" },
                    maxResults: { type: "NUMBER", description: "Maximum results (default 20)" },
                },
                required: ["pattern"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const pattern = String(args.pattern || "");
                const directory = String(args.directory || ".");
                const maxResults = typeof args.maxResults === "number"
                    ? Math.min(50, args.maxResults)
                    : 20;

                const safePath = this.pathGuard.validate(directory);
                const results: Array<{ file: string; line: number; content: string }> = [];

                await this.searchDirectory(safePath, pattern, results, maxResults);

                return {
                    result: JSON.stringify({
                        pattern,
                        matchCount: results.length,
                        matches: results,
                    }),
                };
            },
        });

        // run_command
        this.register({
            name: "run_command",
            description: "Execute system binaries without shell context. Restricted to allowlist.",
            isSafe: false,
            timeoutMs: 30000,
            parameters: {
                type: "OBJECT",
                properties: {
                    binary: { type: "STRING", description: "Binary name from allowlist" },
                    params: { type: "ARRAY", items: { type: "STRING" }, description: "Arguments" },
                },
                required: ["binary", "params"],
            },
            handler: async (args: ToolArgs): Promise<ToolResult> => {
                const binary = String(args.binary || "");
                const params = args.params as string[] || [];

                if (!this.allowedBinaries.has(binary)) {
                    throw new SecurityViolation(
                        `Binary '${binary}' is not in the execution allowlist.`
                    );
                }

                if (!Array.isArray(params)) {
                    throw new SecurityViolation("Command 'params' must be an array of strings.");
                }

                const { stdout, stderr } = await execFileAsync(binary, params, {
                    cwd: this.pathGuard.getRoot(),
                    timeout: 30000,
                    windowsHide: true,
                    env: { ...process.env, NODE_ENV: "production" },
                });

                const out = (stdout || "").toString();
                const err = (stderr || "").toString().trim();
                return err ? { result: out, error: err } : { result: out };
            },
        });
    }

    /**
     * Recursive directory search for search_files tool
     */
    private async searchDirectory(
        dirPath: string,
        pattern: string,
        results: Array<{ file: string; line: number; content: string }>,
        maxResults: number,
        depth: number = 0
    ): Promise<void> {
        if (results.length >= maxResults || depth > 5) return;

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (results.length >= maxResults) break;

                const fullPath = path.join(dirPath, entry.name);
                const relativePath = path.relative(this.pathGuard.getRoot(), fullPath);

                // Skip node_modules and hidden directories
                if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

                if (entry.isDirectory()) {
                    await this.searchDirectory(fullPath, pattern, results, maxResults, depth + 1);
                } else if (entry.isFile()) {
                    // Only search text files under size limit
                    try {
                        const stat = await fs.stat(fullPath);
                        if (stat.size > 100000) continue; // Skip files > 100KB

                        const content = await fs.readFile(fullPath, "utf-8");
                        const lines = content.split("\n");

                        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                            if (lines[i].includes(pattern)) {
                                results.push({
                                    file: relativePath,
                                    line: i + 1,
                                    content: lines[i].substring(0, 200),
                                });
                            }
                        }
                    } catch {
                        // Skip unreadable files
                    }
                }
            }
        } catch {
            // Skip unreadable directories
        }
    }
}
