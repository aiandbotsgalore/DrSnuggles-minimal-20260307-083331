/**
 * OramaIntegration.ts
 * 
 * Lightweight wrapper around Orama for RAG-powered long-term memory
 */

import { create, insert, search } from "@orama/orama";
import type { Orama, SearchParams } from "@orama/orama";
import type { IMemoryBackend, Memory, MemorySearchResult } from "../types";
import fs from "fs";

// @ts-ignore - module resolution issue with persistence plugin (mirrors KnowledgeStore usage)
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";

type OramaMemoryOptions = {
    persistencePath?: string;
    autosaveDebounceMs?: number;
};

export class OramaMemory implements IMemoryBackend {
    private db: Orama<any> | null = null;
    private initialized: boolean = false;
    private persistencePath: string | null = null;
    private autosaveDebounceMs: number = 2000;
    private persistTimer: NodeJS.Timeout | null = null;
    private persistInFlight: Promise<void> | null = null;

    constructor(options?: OramaMemoryOptions) {
        this.persistencePath = options?.persistencePath || null;
        this.autosaveDebounceMs = options?.autosaveDebounceMs ?? 2000;
    }

    public setPersistencePath(persistencePath: string | null | undefined): void {
        this.persistencePath = persistencePath || null;
    }

    /**
     * Initialize the Orama database
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            if (this.persistencePath && fs.existsSync(this.persistencePath)) {
                try {
                    this.db = await restoreFromFile("json", this.persistencePath) as Orama<any>;
                    console.log(`✅ Orama memory restored from: ${this.persistencePath}`);
                } catch (e) {
                    console.warn(`⚠️ Orama restore failed, creating new memory DB. Path: ${this.persistencePath}`);
                    this.db = null;
                }
            }

            if (!this.db) {
                this.db = await create({
                    schema: {
                        id: "string",
                        content: "string",
                        category: "string",
                        timestamp: "number",
                    },
                });
            }

            this.initialized = true;
            console.log("✅ Orama memory initialized");
        } catch (error) {
            console.error("❌ Failed to initialize Orama:", error);
            throw error;
        }
    }

    /**
     * Save a new memory
     */
    async saveMemory(content: string, category: string = "general"): Promise<void> {
        if (!this.db) {
            await this.initialize();
        }

        try {
            await insert(this.db!, {
                id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                content,
                category,
                timestamp: Date.now(),
            });

            console.log(`💾 Memory saved: ${content.substring(0, 50)}...`);
            this.schedulePersist();
        } catch (error) {
            console.error("❌ Failed to save memory:", error);
        }
    }

    /**
     * Save a raw conversation turn (lossless transcript memory).
     * Kept separate from tool-facing saveMemory() to avoid schema churn.
     */
    async saveConversationTurn(turn: { role: "user" | "assistant"; text: string; timestamp?: number; sessionId?: string }): Promise<void> {
        if (!this.db) {
            await this.initialize();
        }

        const ts = typeof turn.timestamp === "number" ? turn.timestamp : Date.now();
        const sessionTag = turn.sessionId ? `/${turn.sessionId}` : "";
        const category = `conversation/${turn.role}${sessionTag}`;

        try {
            await insert(this.db!, {
                id: `turn_${ts}_${Math.random().toString(36).substr(2, 9)}`,
                content: turn.text,
                category,
                timestamp: ts,
            });
            this.schedulePersist();
        } catch (error) {
            console.error("❌ Failed to save conversation turn:", error);
        }
    }

    /**
     * Search for relevant memories
     */
    async search(query: string, limit: number = 5): Promise<MemorySearchResult[]> {
        if (!this.db) {
            await this.initialize();
        }

        try {
            const searchParams: SearchParams<Orama<any>> = {
                term: query,
                limit,
                properties: ["content", "category"],
            };

            const results = await search(this.db!, searchParams);

            return results.hits.map((hit: any) => ({
                id: hit.document.id,
                content: hit.document.content,
                score: hit.score,
            }));
        } catch (error) {
            console.error("❌ Failed to search memories:", error);
            return [];
        }
    }

    /**
     * Get recent memories by category
     */
    async getRecentByCategory(category: string, limit: number = 10): Promise<MemorySearchResult[]> {
        return this.search(category, limit);
    }

    /**
     * Get all memories (for debugging)
     */
    async getAllMemories(): Promise<Memory[]> {
        if (!this.db) return [];

        try {
            const results = await search(this.db, {
                term: "",
                limit: 1000,
            });

            return results.hits.map((hit: any) => hit.document as Memory);
        } catch (error) {
            console.error("❌ Failed to get all memories:", error);
            return [];
        }
    }

    /**
     * Clear all memories (use with caution!)
     */
    async clear(): Promise<void> {
        if (this.db) {
            // Reinitialize to clear
            this.initialized = false;
            await this.initialize();
            console.log("🗑️ Memory cleared");
        }
    }

    /**
     * Flush memory (No-op for in-memory Orama, but required by interface)
     */
    async flush(): Promise<void> {
        await this.persistNow();
    }

    private schedulePersist(): void {
        if (!this.persistencePath) return;
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistNow();
        }, this.autosaveDebounceMs);
    }

    private async persistNow(): Promise<void> {
        if (!this.persistencePath || !this.db) return;
        if (this.persistInFlight) return this.persistInFlight;

        this.persistInFlight = (async () => {
            try {
                await persistToFile("json", this.db!, this.persistencePath!);
            } catch (e) {
                console.error("❌ Failed to persist Orama memory:", e);
            } finally {
                this.persistInFlight = null;
            }
        })();

        return this.persistInFlight;
    }
}
