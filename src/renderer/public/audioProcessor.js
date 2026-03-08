class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sampleRate = 48000;
        this.chunkSize = 1024;
        this.buffer = new Float32Array(this.chunkSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0];
            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bufferIndex++] = channelData[i];
                if (this.bufferIndex >= this.chunkSize) {
                    this.port.postMessage(this.buffer.slice());
                    this.bufferIndex = 0;
                }
            }
        }
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
