/**
 * SPEECH RECOGNITION SERVICE - Renderer
 *
 * Singleton service to manage the browser's SpeechRecognition API.
 * 
 * Problem Solved:
 * Browsers typically allow only one active SpeechRecognition instance at a time.
 * Previously, AudioCaptureService and AudioPlaybackService both created their own,
 * causing race conditions and one service silently killing the other.
 * 
 * Features:
 * - Singleton pattern to ensure one active recognizer
 * - Restart logic for continuous listening (solving the "stops after 4 seconds" issue)
 * - Error handling and backoff
 * - Event-based architecture for multiple consumers
 */

import EventEmitter from 'eventemitter3';


// Polyfill types for SpeechRecognition (not in all TS libs)
interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: (event: Event) => void;
    onend: (event: Event) => void;
    onerror: (event: any) => void;
    onresult: (event: SpeechRecognitionEvent) => void;
}

declare global {
    interface Window {
        SpeechRecognition: {
            new (): SpeechRecognition;
        };
        webkitSpeechRecognition: {
            new (): SpeechRecognition;
        };
    }
}

export interface SpeechRecognitionEvents {
    result: (text: string, isFinal: boolean) => void;
    start: () => void;
    end: () => void;
    error: (error: any) => void;
}

class SpeechRecognitionService extends EventEmitter<SpeechRecognitionEvents> {
    private recognition: SpeechRecognition | null = null;
    private isListening: boolean = false;
    private shouldBeListening: boolean = false;
    private restartCount: number = 0;
    private readonly MAX_RESTARTS = 5;
    private restartTimer: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.init();
    }

    private init() {
        // @ts-ignore - Vendor prefixes
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('[SpeechRecognitionService] Browser does not support SpeechRecognition');
            return;
        }

        try {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.setupListeners();
            console.log('[SpeechRecognitionService] Initialized');
        } catch (e) {
            console.error('[SpeechRecognitionService] Failed to initialize:', e);
        }
    }

    private setupListeners() {
        if (!this.recognition) return;

        this.recognition.onstart = () => {
            console.log('[SpeechRecognitionService] 🟢 Started');
            this.isListening = true;
            this.restartCount = 0;
            this.emit('start');
        };

        this.recognition.onend = () => {
            console.log('[SpeechRecognitionService] 🔴 Stopped');
            this.isListening = false;
            this.emit('end');

            // Auto-restart if we should still be listening
            if (this.shouldBeListening) {
                this.handleAutoRestart();
            }
        };

        this.recognition.onerror = (event: any) => {
            // Ignore "no-speech" errors as they are normal in silence
            if (event.error === 'no-speech') return;

            console.warn('[SpeechRecognitionService] Error:', event.error);
            this.emit('error', event.error);
        };

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            let finalTranscript = '';

            // Process results
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript) {
                this.emit('result', finalTranscript.trim(), true);
            }
            if (interimTranscript) {
                this.emit('result', interimTranscript.trim(), false);
            }
        };
    }

    private handleAutoRestart() {
        if (this.restartCount >= this.MAX_RESTARTS) {
            console.warn('[SpeechRecognitionService] Max restarts reached. Stopping.');
            this.shouldBeListening = false;
            return;
        }

        this.restartCount++;
        const delay = Math.min(1000 * Math.pow(1.5, this.restartCount), 10000); // Exponential backoff

        console.log(`[SpeechRecognitionService] Restarting in ${delay}ms... (Attempt ${this.restartCount})`);
        
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.start();
        }, delay);
    }

    /**
     * Start listening.
     * Safe to call multiple times (idempotent).
     */
    public start() {
        if (!this.recognition) return;
        this.shouldBeListening = true;

        if (this.isListening) return;

        try {
            this.recognition.start();
        } catch (e) {
            console.warn('[SpeechRecognitionService] Failed to start:', e);
        }
    }

    /**
     * Stop listening.
     */
    public stop() {
        this.shouldBeListening = false;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        
        if (this.recognition && this.isListening) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('[SpeechRecognitionService] Failed to stop:', e);
            }
        }
    }

    /**
     * Manually abort (force stop)
     */
    public abort() {
        this.shouldBeListening = false;
        if (this.restartTimer) clearTimeout(this.restartTimer);

        if (this.recognition) {
            try {
                this.recognition.abort();
            } catch (e) {
                console.warn('[SpeechRecognitionService] Failed to abort:', e);
            }
        }
    }
}

// Export singleton instance
export const speechService = new SpeechRecognitionService();
