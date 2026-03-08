import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
    error?: {
        message: string;
        stack?: string;
        name: string;
    };
}

/**
 * Structured Logger for Dr. Snuggles
 * Writes JSON logs to file and human-readable text to console.
 */
export class StructuredLogger {
    private logPath: string | null = null;
    private logStream: fs.WriteStream | null = null;

    constructor() { }

    public initialize(logDir: string, filename: string = 'snuggles_service.log'): void {
        try {
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            this.logPath = path.join(logDir, filename);
            // 'a' flag for append
            this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });

            this.info('Logger initialized', { path: this.logPath });
        } catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }

    public log(level: LogLevel, message: string, ...args: any[]): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };

        // Extract stats/metadata or errors from args
        if (args.length > 0) {
            const lastArg = args[args.length - 1];
            if (lastArg instanceof Error) {
                entry.error = {
                    message: lastArg.message,
                    stack: lastArg.stack,
                    name: lastArg.name
                };
            } else if (typeof lastArg === 'object' && lastArg !== null) {
                entry.context = this.safeSerialize(lastArg);
            }
        }

        // 1. Write structured JSON to file
        if (this.logStream) {
            this.logStream.write(JSON.stringify(entry) + '\n');
        }

        // 2. Write human readable to console (bypass consle.log override to prevent recursion)
        const color = this.getColor(level);
        const reset = '\x1b[0m';
        const argStr = args.length ? args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') : '';
        const consoleMsg = `${color}[${entry.timestamp}] [${level}] ${message}${reset} ${argStr}\n`;

        process.stdout.write(consoleMsg);
    }

    public info(message: string, ...args: any[]) { this.log('INFO', message, ...args); }
    public warn(message: string, ...args: any[]) { this.log('WARN', message, ...args); }
    public error(message: string, ...args: any[]) { this.log('ERROR', message, ...args); }
    public debug(message: string, ...args: any[]) { this.log('DEBUG', message, ...args); }

    private getColor(level: LogLevel): string {
        switch (level) {
            case 'INFO': return '\x1b[36m'; // Cyan
            case 'WARN': return '\x1b[33m'; // Yellow
            case 'ERROR': return '\x1b[31m'; // Red
            case 'DEBUG': return '\x1b[90m'; // Gray
            default: return '\x1b[37m'; // White
        }
    }

    // Handle circular references
    private safeSerialize(obj: any): any {
        const seen = new WeakSet();
        return JSON.parse(JSON.stringify(obj, (_key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            return value;
        }));
    }
}

export const logger = new StructuredLogger();
