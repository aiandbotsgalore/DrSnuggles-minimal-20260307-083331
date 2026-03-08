
import { wsBridge } from './services/websocketClient';
import { IPC_CHANNELS, VolumeData, ConnectionStatus, ConversationTurn } from '../shared/types'; // Fixed path

/**
 * Browser Bridge for snugglesAPI
 * 
 * Injects a WebSocket-backed implementation of the `snugglesAPI` global object.
 * This allows the existing UI to work in Chrome without modification.
 */

// Helper to wrap wsBridge.on in a cleanup function
const createListener = <T>(channel: string, callback: (data: T) => void) => {
    const handler = (data: T) => callback(data);
    wsBridge.on(channel, handler);
    return () => wsBridge.off(channel, handler);
};

const snugglesAPI = {
    // Media Devices (We can now just use browser native, but for compat we mock it)
    getAudioDevices: async () => {
        // In browser, we use native enumeration
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.map(d => ({
                id: d.deviceId,
                label: d.label || 'Unknown Device',
                kind: d.kind as 'audioinput' | 'audiooutput'
            }));
        } catch (e) {
            return [];
        }
    },
    setAudioDevices: async () => true, // Browser manages this via UI selection usually

    // core methods redirected to WS
    // NOTE: CONNECT_GEMINI is legacy. We use GENAI_START_SESSION for December 2025 architecture.
    connect: () => wsBridge.invoke(IPC_CHANNELS.GENAI_START_SESSION),
    disconnect: () => wsBridge.invoke(IPC_CHANNELS.STREAM_STATUS, false), // Toggle stream off
    sendMessage: (text: string) => wsBridge.invoke(IPC_CHANNELS.SEND_MESSAGE, text),
    toggleMute: () => wsBridge.invoke(IPC_CHANNELS.TOGGLE_MUTE),
    resetAgent: () => wsBridge.invoke(IPC_CHANNELS.RESET_AGENT),
    getStatus: () => wsBridge.invoke(IPC_CHANNELS.GET_STATUS),
    searchKnowledge: (query: string) => wsBridge.invoke(IPC_CHANNELS.SEARCH_KNOWLEDGE, query),
    loadKnowledge: () => wsBridge.invoke(IPC_CHANNELS.LOAD_KNOWLEDGE),

    // Listeners
    onVolumeUpdate: (cb: (data: VolumeData) => void) => createListener(IPC_CHANNELS.VOLUME_UPDATE, cb),
    onConnectionStatus: (cb: (status: ConnectionStatus) => void) => createListener(IPC_CHANNELS.CONNECTION_STATUS, cb),
    onMessageReceived: (cb: (msg: ConversationTurn) => void) => createListener(IPC_CHANNELS.MESSAGE_RECEIVED, cb),

    // GenAI / Audio Streaming
    genaiStartSession: (config?: any) => wsBridge.invoke(IPC_CHANNELS.GENAI_START_SESSION, config),
    genaiSendAudioChunk: (_chunk: Float32Array) => {
        // No-op: NativeAudioManager captures mic audio directly in the main process.
        // Browser does NOT need to send audio over WebSocket.
        return Promise.resolve(0);
    },

    onGenaiAudioReceived: (cb: (audio: Float32Array) => void) => {
        return createListener(IPC_CHANNELS.GENAI_AUDIO_RECEIVED, (data: any) => {
            if (data instanceof Float32Array) {
                // Binary mode: Already a Float32Array from websocketClient
                cb(data);
            } else {
                // Legacy JSON mode: Data comes as object {0:0.1, ...} or array
                const chunk = new Float32Array(Object.values(data));
                cb(chunk);
            }
        });
    },

    onGenaiLatencyUpdate: (cb: (m: any) => void) => createListener(IPC_CHANNELS.GENAI_LATENCY_UPDATE, cb),
    onGenaiVADState: (cb: (s: any) => void) => createListener(IPC_CHANNELS.GENAI_VAD_STATE, cb),
    onGenaiInterruption: (cb: () => void) => createListener(IPC_CHANNELS.GENAI_INTERRUPTION, cb),

    setVoiceMode: (mode: any) => wsBridge.invoke(IPC_CHANNELS.SET_VOICE_MODE, mode),
    getVoiceMode: () => wsBridge.invoke(IPC_CHANNELS.GET_VOICE_MODE),

    // Interaction Tracing APIs
    getTrace: (interactionId: string) => wsBridge.invoke(IPC_CHANNELS.TRACE_GET, interactionId),
    getAllTraces: () => wsBridge.invoke(IPC_CHANNELS.TRACE_GET_ALL),
    emitTraceEvent: (event: any) => wsBridge.send(IPC_CHANNELS.TRACE_EVENT, event),

    // Vitals (Telemetry Overlay)
    onVitalsUpdate: (cb: (data: any) => void) => createListener(IPC_CHANNELS.VITALS_UPDATE, cb),
    onVitalsPing: (cb: (pingId: string) => void) => createListener(IPC_CHANNELS.VITALS_PING, cb),
    sendVitalsPong: (pingId: string, heapMb: number) => wsBridge.send(IPC_CHANNELS.VITALS_PONG, { pingId, heapMb }),
    onVitalsToggle: (cb: () => void) => createListener(IPC_CHANNELS.VITALS_TOGGLE, cb),
    toggleVitals: () => wsBridge.send(IPC_CHANNELS.VITALS_TOGGLE, {}),
    sendAudioStats: (queueMs: number, clockMs: number) => wsBridge.send(IPC_CHANNELS.VITALS_AUDIO_STATS, { queueMs, clockMs }),

    // Stream status listener
    onStreamStatus: (cb: (data: { isLive: boolean }) => void) => createListener(IPC_CHANNELS.STREAM_STATUS, cb)
};

// Inject into global scope only if not running in Electron (where it's already provided via contextBridge)
if (!(window as any).snugglesAPI) {
    (window as any).snugglesAPI = snugglesAPI;
    console.log('[BrowserBridge] snugglesAPI injected via WebSocket');
} else {
    console.log('[BrowserBridge] Skipping injection: snugglesAPI already exists (Native Electron Mode)');
}
