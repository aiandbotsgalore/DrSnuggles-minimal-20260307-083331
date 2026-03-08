
import { IPC_CHANNELS } from '../../shared/types';
import { EventEmitter } from 'eventemitter3';
import { FEATURE_FLAGS } from '../../config/performance.config';

/**
 * Binary Framing Protocol Constants
 * 4-byte header for proper Float32Array alignment
 */
const BINARY_MSG_TYPE = {
    MIC_INPUT: 0x01,      // Microphone audio (renderer → main)
    GEMINI_OUTPUT: 0x02,  // Gemini audio (main → renderer)
} as const;

/**
 * WebSocket Client Bridge for Browser
 *
 * Replaces window.electron.ipcRenderer behavior.
 * Connects to the local Dr. Snuggles backend.
 * Supports binary audio transport with 4-byte aligned framing.
 */
class WebSocketBridge extends EventEmitter {
    private socket: WebSocket | null = null;
    private requestMap: Map<string, (response: any) => void> = new Map();
    private url: string = 'ws://127.0.0.1:3030';
    private queuedMessages: string[] = [];
    private readonly maxQueuedMessages = 100;


    constructor() {
        super();
        this.connect();
    }

    private connect() {
        console.log(`[WS-Bridge] Connecting to ${this.url}...`);
        try {
            this.socket = new WebSocket(this.url);
            this.socket.binaryType = 'arraybuffer';

            this.socket.onopen = () => {
                console.log('[WS-Bridge] Connected to Brain');
                this.flushQueuedMessages();
                this.emit('connected');
            };

            this.socket.onerror = (error) => {
                // Log specific error details to the console
                console.error('[WS-Bridge] WebSocket Error:', error);
            };

            this.socket.onclose = (event) => {
                console.log(`[WS-Bridge] Disconnected (Code: ${event.code})`);
                // Reconnect loop (unless clean close)
                if (event.code !== 1000) {
                    setTimeout(() => this.connect(), 2000);
                }
            };

            this.socket.onmessage = (event) => {
                // Handle binary messages (audio data with 4-byte header)
                if (FEATURE_FLAGS.ENABLE_BINARY_WS && event.data instanceof ArrayBuffer) {
                    this.handleBinaryMessage(event.data);
                    return;
                }

                // Handle JSON messages (control, responses, etc.)
                try {
                    const data = JSON.parse(event.data);
                    const { type, id, payload } = data;

                    // Handle Response to a previous Request
                    if (id && this.requestMap.has(id)) {
                        const resolve = this.requestMap.get(id);
                        if (resolve) resolve(payload);
                        this.requestMap.delete(id);
                        return;
                    }

                    // Handle Push Event (e.g. audio received in legacy JSON mode)
                    this.emit(type, payload);

                } catch (e) {
                    // Ignore parsing errors for now
                }
            };
        } catch (e) {
            console.error('[WS-Bridge] Setup Error:', e);
        }
    }

    private flushQueuedMessages(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.queuedMessages.length === 0) {
            return;
        }
        const pending = [...this.queuedMessages];
        this.queuedMessages = [];
        for (const message of pending) {
            this.socket.send(message);
        }
    }

    /**
     * Handle incoming binary audio message with 4-byte header framing
     * Header: [type (1 byte), reserved (3 bytes)] + Float32Array payload
     */
    private handleBinaryMessage(buffer: ArrayBuffer): void {
        // Validation: minimum size (4-byte header)
        if (buffer.byteLength < 4) {
            console.warn('[WS-Bridge] Binary message too small, discarding');
            return;
        }

        // Validation: payload must be 4-byte aligned for Float32Array
        if ((buffer.byteLength - 4) % 4 !== 0) {
            console.warn('[WS-Bridge] Binary message not 4-byte aligned, discarding');
            return;
        }

        const view = new DataView(buffer);
        const msgType = view.getUint8(0);

        // Extract Float32Array from offset 4 (after 4-byte header)
        const audioData = new Float32Array(buffer, 4);

        switch (msgType) {
            case BINARY_MSG_TYPE.GEMINI_OUTPUT:
                // Audio from Gemini → emit to playback service
                this.emit(IPC_CHANNELS.GENAI_AUDIO_RECEIVED, audioData);
                break;

            default:
                console.warn(`[WS-Bridge] Unknown binary message type: ${msgType}`);
        }
    }

    // Simulate ipcRenderer.invoke (Request/Response)
    public invoke(channel: string, ...args: any[]): Promise<any> {
        console.log(`[WS-Bridge] Invoke: ${channel}`, args);
        return new Promise((resolve) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                console.warn(`[WS-Bridge] Cannot invoke ${channel}: Socket not open`);
                resolve(null); // Fail gracefully if offline
                return;
            }

            const id = crypto.randomUUID();
            const timeoutId = window.setTimeout(() => {
                if (this.requestMap.has(id)) {
                    this.requestMap.delete(id);
                    console.warn(`[WS-Bridge] Invoke timeout: ${channel}`);
                    resolve(null);
                }
            }, 5000); // 5s timeout

            this.requestMap.set(id, (response) => {
                window.clearTimeout(timeoutId);
                resolve(response);
            });

            this.socket.send(JSON.stringify({
                type: channel,
                id,
                payload: args
            }));
        });
    }

    // Simulate ipcRenderer.send (Fire and forget)
    public send(channel: string, data?: any): void {
        console.log(`[WS-Bridge] Send: ${channel}`, data);
        const payload = JSON.stringify({
            type: channel,
            payload: data
        });

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(payload);
        } else {
            console.warn(`[WS-Bridge] Socket not open, queueing ${channel}`);
            if (this.queuedMessages.length >= this.maxQueuedMessages) {
                this.queuedMessages.shift();
            }
            this.queuedMessages.push(payload);
        }
    }

    /**
     * Send raw binary data with 4-byte header framing
     * Used for optimized audio transport
     */
    public sendBinary(msgType: number, audioData: Float32Array): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Create buffer: 4-byte header + Float32Array payload
        const headerSize = 4;
        const payloadSize = audioData.byteLength;
        const buffer = new ArrayBuffer(headerSize + payloadSize);

        // Write header: [type, 0, 0, 0] (padding for 4-byte alignment)
        const headerView = new DataView(buffer);
        headerView.setUint8(0, msgType);
        headerView.setUint8(1, 0); // Reserved
        headerView.setUint8(2, 0); // Reserved
        headerView.setUint8(3, 0); // Reserved

        // Copy audio data after header
        const payloadView = new Float32Array(buffer, headerSize);
        payloadView.set(audioData);

        this.socket.send(buffer);
    }
}

export const wsBridge = new WebSocketBridge();
export { BINARY_MSG_TYPE };
