
function copy(dest: Float32Array, destOffset: number, src: Float32Array, srcOffset: number, length: number, channels: number) {
    const l = length * channels;
    const s = new Float32Array(src.buffer, src.byteOffset + srcOffset, l);
    const d = new Float32Array(dest.buffer, dest.byteOffset + destOffset, l);
    for (let i = 0; i < l; ++i) {
        d[i] = s[i];
    }
}

function copyF2A(dest: Float32Array[], destOffset: number, src: Float32Array, srcOffset: number, length: number, channels: number) {
    const s = new Float32Array(src.buffer, src.byteOffset + srcOffset, length * channels);
    for (let ch = 0; ch < dest.length; ++ch) {
        const d = new Float32Array(dest[ch].buffer, dest[ch].byteOffset + destOffset, length);
        for (let si = ch, di = 0; di < length; si += channels, ++di) {
            d[di] = s[si];
        }
    }
}

function copyA2F(dest: Float32Array, destOffset: number, src: Float32Array[], srcOffset: number, length: number, channels: number) {
    const d = new Float32Array(dest.buffer, dest.byteOffset + destOffset, length * channels);
    for (let ch = 0; ch < src.length; ++ch) {
        const s = new Float32Array(src[ch].buffer, src[ch].byteOffset + srcOffset, length);
        for (let si = 0, di = ch; si < length; ++si, di += channels) {
            d[di] = s[si];
        }
    }
}

export default class CircularBuffer {
    private readonly buffer: Float32Array;

    private readCur = 0;
    get readCursor(): number { return this.readCur; }

    private writeCur = 0;
    get writeCursor(): number { return this.writeCur; }

    private remain_ = 0;
    get remain(): number { return this.remain_; }

    constructor(public readonly samples: number, public readonly channels: number) {
        this.buffer = new Float32Array(samples * channels);
        this.remain_ = 0;
    }

    reset(): void {
        this.readCur = 0;
        this.writeCur = 0;
        this.remain_ = 0;
    }

    write(src: Float32Array[]): number {
        const dest = this.buffer;
        const samples = this.samples;
        const channels = this.channels;
        const readCur = this.readCur;
        let writeCur = this.writeCur;
        let remain = this.remain_;

        const len = Math.min(samples - remain, src[0].length);
        let pos = 0;
        while (pos < len) {
            let sizePerCh = len - pos;
            if (readCur < writeCur && samples - writeCur < sizePerCh) {
                sizePerCh = samples - writeCur;
            }
            copyA2F(dest, writeCur * channels * 4, src, pos * 4, sizePerCh, channels);
            pos += sizePerCh;
            remain += sizePerCh;
            writeCur += sizePerCh;
            if (writeCur >= samples) {
                writeCur -= samples;
            }
        }

        this.writeCur = writeCur;
        this.remain_ = remain;
        return len;
    }

    writeInterleaved(src: Float32Array): number {
        const dest = this.buffer;
        const samples = this.samples;
        const channels = this.channels;
        const readCur = this.readCur;
        let writeCur = this.writeCur;
        let remain = this.remain_;

        const len = Math.min(samples - remain, src.length / channels | 0);
        let pos = 0;
        while (pos < len) {
            let sizePerCh = len - pos;
            if (readCur < writeCur && samples - writeCur < sizePerCh) {
                sizePerCh = samples - writeCur;
            }
            copy(dest, writeCur * channels * 4, src, pos * channels * 4, sizePerCh, channels);
            pos += sizePerCh;
            remain += sizePerCh;
            writeCur += sizePerCh;
            if (writeCur >= samples) {
                writeCur -= samples;
            }
        }

        this.writeCur = writeCur;
        this.remain_ = remain;
        return len;
    }

    read(dest: Float32Array[]): number {
        const src = this.buffer;
        const samples = this.samples;
        const channels = this.channels;
        const writeCur = this.writeCur;
        let readCur = this.readCur;
        let remain = this.remain_;

        const len = Math.min(remain, dest[0].length);
        let pos = 0;
        while (pos < len) {
            let sizePerCh = len - pos;
            if (writeCur < readCur && samples - readCur < sizePerCh) {
                sizePerCh = samples - readCur;
            }
            copyF2A(dest, pos * 4, src, readCur * channels * 4, sizePerCh, channels);
            pos += sizePerCh;
            remain -= sizePerCh;
            readCur += sizePerCh;
            if (readCur >= samples) {
                readCur -= samples;
            }
        }

        this.readCur = readCur;
        this.remain_ = remain;
        return len;
    }

    readInterleaved(dest: Float32Array): number {
        const src = this.buffer;
        const samples = this.samples;
        const channels = this.channels;
        const writeCur = this.writeCur;
        let readCur = this.readCur;
        let remain = this.remain_;

        const len = Math.min(remain, dest.length / channels | 0);
        let pos = 0;
        while (pos < len) {
            let sizePerCh = len - pos;
            if (writeCur < readCur && samples - readCur < sizePerCh) {
                sizePerCh = samples - readCur;
            }
            copy(dest, pos * channels * 4, src, readCur * channels * 4, sizePerCh, channels);
            pos += sizePerCh;
            remain -= sizePerCh;
            readCur += sizePerCh;
            if (readCur >= samples) {
                readCur -= samples;
            }
        }

        this.readCur = readCur;
        this.remain_ = remain;
        return len;
    }
}