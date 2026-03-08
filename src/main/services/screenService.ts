import { desktopCapturer, screen } from 'electron';
import { EventEmitter } from 'eventemitter3';

/**
 * Service for capturing screen content.
 * Provides functionality to take screenshots and manage screen recording.
 */
export class ScreenService extends EventEmitter {
    private isRecording: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;
    private lastScreenshotBase64: string | null = null;

    constructor() {
        super();
    }

    /**
     * Capture the primary screen as a base64 encoded JPEG image.
     * optimized for multimodal input (60-80% quality).
     */
    async captureScreen(): Promise<string | null> {
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height }
            });

            // Find primary screen
            const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];

            if (!primarySource) {
                console.error('[ScreenService] No screen source found');
                return null;
            }

            // Convert to JPEG base64 (efficient for Gemini)
            // resize slightly to save bandwidth if resolution is huge
            const image = primarySource.thumbnail;
            const resized = image.resize({ width: 1280 }); // Normalize width to 720p/1080p range for speed
            const base64 = resized.toJPEG(70); // 70% quality

            this.lastScreenshotBase64 = base64.toString('base64');
            return this.lastScreenshotBase64;

        } catch (error) {
            console.error('[ScreenService] Capture failed:', error);
            return null;
        }
    }

    /**
     * Start periodic screen capture (e.g. for "watching" user workflow)
     * @param intervalMs How often to capture (default 5000ms)
     */
    startWatching(intervalMs: number = 5000) {
        if (this.isRecording) return;
        this.isRecording = true;
        console.log(`[ScreenService] Started watching screen (interval: ${intervalMs}ms)`);

        this.intervalId = setInterval(async () => {
            const screenshot = await this.captureScreen();
            if (screenshot) {
                this.emit('screenshot', screenshot);
            }
        }, intervalMs);
    }

    stopWatching() {
        if (!this.isRecording) return;
        this.isRecording = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('[ScreenService] Stopped watching screen');
    }
}
