
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

/**
 * WebSocket Server Bridge
 *
 * Commands and telemetry only — NO audio transport.
 * Audio I/O is handled entirely by NativeAudioManager in the main process.
 */

/**
 * WebSocket Server Bridge
 *
 * Replaces Electron IPC for browser-based communication.
 * Helper utility to map WebSocket messages to internal event handlers.
 * Supports binary audio transport with 4-byte aligned framing.
 */
export class SnugglesWebSocketServer extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private port: number = 3030;

    constructor(port: number = 3030) {
        super();
        this.port = port;
    }

    public start(): void {
        try {
            this.wss = new WebSocketServer({ port: this.port });
            console.log(`[WebSocket] ✅ Server started successfully on port ${this.port}`);
        } catch (err: any) {
            console.error(`[WebSocket] ❌ FATAL: Failed to start locally on port ${this.port}: ${err.message}`);
            console.error('[WebSocket] Is another instance (or checking process) holding this port?');
            // We do NOT return here, we let the properties be null so other methods fail gracefully
        }

        if (!this.wss) return;

        // Fix 1: Add server-level error handler to prevent crashes
        this.wss.on('error', (error: Error) => {
             // Handle EADDRINUSE specifically
            if ((error as any).code === 'EADDRINUSE') {
                console.error(`[WebSocket] ❌ Port ${this.port} is already in use!`);
            } else {
                console.error('[WebSocket] Server error:', error.message);
            }
            this.emit('error', error);
        });

        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[WebSocket] Client connected');
            this.clients.add(ws);
            this.emit('client-connected', ws);

            // Fix 1: Add client-level error handler
            ws.on('error', (error: Error) => {
                console.error('[WebSocket] Client connection error:', error.message);
                // Remove the client on error to prevent further issues
                this.clients.delete(ws);
            });

            ws.on('message', (message: Buffer | string) => {
                // Guard: silently discard binary messages.
                // NativeAudioManager handles all audio I/O, so binary frames
                // from legacy browser code are safely ignored.
                if (Buffer.isBuffer(message) && message.length > 0 && message[0] !== 0x7B) {
                    // Not a JSON message (doesn't start with '{'), skip it
                    return;
                }

                // Handle JSON messages only (control, telemetry)
                try {
                    const data = JSON.parse(message.toString());
                    const { type, payload, id } = data;

                    // Emit event for Main Process to handle
                    // We map the socket message "type" to our existing IPC event names
                    // Fix: Spread payload if it's an array to support multi-argument handlers
                    const args = Array.isArray(payload) ? payload : [payload];
                    this.emit(type, ...args, (response: any) => {
                        // Callback to send response back to specific request (if ID exists)
                        if (id) {
                            ws.send(JSON.stringify({
                                type: `${type}:response`,
                                id,
                                payload: response
                            }));
                        }
                    });

                } catch (e) {
                    console.error('[WebSocket] Failed to parse message:', e);
                }
            });

            ws.on('close', () => {
                console.log('[WebSocket] Client disconnected');
                this.clients.delete(ws);
                this.emit('client-disconnected', ws);
            });
        });
    }

    // Broadcast JSON message to all connected clients (commands/telemetry only)
    public broadcast(type: string, payload: any): void {
        const message = JSON.stringify({ type, payload });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    public sendToClient(client: WebSocket, type: string, payload: any): void {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, payload }));
        }
    }

    public stop(): void {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }
}
