/**
 * PathGuard.ts
 * 
 * Security module for filesystem path validation
 * Prevents path traversal attacks and protects sensitive files
 */

import path from "path";
import { minimatch } from "minimatch";
import type { PathValidationResult, SecurityPolicy } from "../types";

/**
 * Security error for path violations
 */
export class SecurityViolation extends Error {
    public readonly code = "SECURITY_VIOLATION";

    constructor(details: string) {
        super(`[Security:VIOLATION] ${details}`);
        this.name = "SecurityViolation";
    }
}

/**
 * Default protected file patterns
 */
const DEFAULT_PROTECTED_PATTERNS = [
    "dr_snuggles.character.json",
    "core_identity.json",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "**/secrets/**",
    "**/node_modules/**",
];

/**
 * PathGuard: Filesystem Security Module
 * 
 * Features:
 * - Path traversal prevention
 * - Protected file pattern matching (glob support)
 * - Absolute path rejection
 * - Workspace sandboxing
 */
export class PathGuard {
    private readonly root: string;
    private readonly protectedPatterns: string[];
    private readonly maxFileSizeBytes: number;

    constructor(
        workspaceRoot: string,
        policy?: Partial<SecurityPolicy>
    ) {
        this.root = path.resolve(workspaceRoot);
        this.protectedPatterns = policy?.protectedPatterns || DEFAULT_PROTECTED_PATTERNS;
        this.maxFileSizeBytes = policy?.maxFileSizeBytes || 1024 * 1024; // 1MB default
    }

    /**
     * Validate a path is safe for reading
     */
    validate(targetPath: string): string {
        const result = this.validatePath(targetPath);
        if (!result.valid) {
            throw new SecurityViolation(result.error || "Path validation failed");
        }
        return result.resolvedPath!;
    }

    /**
     * Validate a path is safe for writing (additional checks)
     */
    validateForWrite(targetPath: string): string {
        const resolved = this.validate(targetPath);

        // Check against protected patterns
        const basename = path.basename(targetPath);
        const relativePath = path.relative(this.root, resolved);

        for (const pattern of this.protectedPatterns) {
            if (minimatch(basename, pattern) || minimatch(relativePath, pattern)) {
                throw new SecurityViolation(
                    `Write operation blocked on protected file: ${basename} (matches pattern: ${pattern})`
                );
            }
        }

        return resolved;
    }

    /**
     * Internal path validation with detailed result
     */
    private validatePath(targetPath: string): PathValidationResult {
        // Check for empty/invalid input
        if (!targetPath || typeof targetPath !== "string") {
            return { valid: false, error: "Path must be a non-empty string." };
        }

        // Trim whitespace
        const trimmed = targetPath.trim();
        if (!trimmed) {
            return { valid: false, error: "Path cannot be empty or whitespace." };
        }

        // Reject absolute paths
        if (path.isAbsolute(trimmed)) {
            return {
                valid: false,
                error: "Absolute paths are forbidden. Use relative workspace paths."
            };
        }

        // Resolve the path
        const resolved = path.resolve(this.root, trimmed);
        const relative = path.relative(this.root, resolved);

        // Check for path traversal
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            return {
                valid: false,
                error: `Path traversal detected: ${targetPath}`
            };
        }

        return { valid: true, resolvedPath: resolved };
    }

    /**
     * Check if a file matches any protected pattern
     */
    isProtected(targetPath: string): boolean {
        const basename = path.basename(targetPath);
        const resolved = path.resolve(this.root, targetPath);
        const relativePath = path.relative(this.root, resolved);

        for (const pattern of this.protectedPatterns) {
            if (minimatch(basename, pattern) || minimatch(relativePath, pattern)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Add a protected pattern dynamically
     */
    addProtectedPattern(pattern: string): void {
        if (!this.protectedPatterns.includes(pattern)) {
            this.protectedPatterns.push(pattern);
        }
    }

    /**
     * Get the workspace root
     */
    getRoot(): string {
        return this.root;
    }

    /**
     * Get max file size limit in bytes
     */
    getMaxFileSize(): number {
        return this.maxFileSizeBytes;
    }

    /**
     * Get all protected patterns
     */
    getProtectedPatterns(): readonly string[] {
        return this.protectedPatterns;
    }
}
