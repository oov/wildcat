import PromiseWorker from './promiseworker';
declare var require: (s: string) => string;
function isError(data: any): data is ['error', any] {
    if (!Array.isArray(data)) {
        return false;
    }
    if (data[0] !== 'error') {
        return false;
    }
    return true;
}

function getTargetSampleRate(): number {
    const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContext() as AudioContextBase;
    return ctx.sampleRate;
}

function loadDataScheme(url: string): Promise<ArrayBuffer> {
    return new Promise(function (resolve, reject) {
        /*
            const r = new XMLHttpRequest();
            r.open('GET', url, true);
            r.responseType = 'arraybuffer';
            r.onload = e => resolve(r.response as ArrayBuffer);
            r.onerror = e => reject();
            r.send(null);
        */

        // XXX - workaround for iOS9
        var b = atob(url.substring(url.indexOf(';base64,') + 8));
        var buf = new Uint8Array(b.length)
        for (var i = 0; i < b.length; ++i) {
            buf[i] = b.charCodeAt(i);
        }
        resolve(buf.buffer);
    });
}

class NativeDecoder {
    private static supported: boolean | null = null;
    static async isSupported(): Promise<boolean> {
        if (NativeDecoder.supported === null) {
            try {
                const ab = await loadDataScheme(require('url-loader!./empty.opus'));
                const r = await NativeDecoder.decode(ab);
                NativeDecoder.supported = r.buffer.length > 0;
            } catch (e) {
                NativeDecoder.supported = false;
            }
        }
        return NativeDecoder.supported;
    }

    static async decode(opus: ArrayBuffer): Promise<{ sampleRate: number, buffer: Float32Array[] }> {
        const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext() as AudioContextBase;
        const buffer = await ctx.decodeAudioData(opus);
        const r = [];
        for (let ch = 0; ch < buffer.numberOfChannels; ++ch) {
            r.push(buffer.getChannelData(ch));
        }
        return { sampleRate: buffer.sampleRate, buffer: r };
    }

}

export async function isDeviceFastEnough(): Promise<boolean> {
    const ab = await loadDataScheme(require('url-loader!./empty.opus')); // 1sec opus file
    const decoder = await Decoder.create(ab, 120, getTargetSampleRate());
    const s = Date.now();
    await decoder.readAll();
    const e = Date.now();
    await decoder.close();
    return e - s < 500;
}

export async function decodeAll(opusData: ArrayBuffer, progress?: (v: number) => void): Promise<{ sampleRate: number, buffer: Float32Array[] }> {
    if (await NativeDecoder.isSupported()) {
        return NativeDecoder.decode(opusData);
    }
    const sampleRate = getTargetSampleRate();
    const decoder = await Decoder.create(opusData, 120, sampleRate);
    const channels = decoder.channels;
    const s = await decoder.readAll(progress);
    const sizePerCh = s.length / channels | 0;
    const buffer = [];
    for (let ch = 0; ch < channels; ++ch) {
        const d = new Float32Array(sizePerCh);
        for (let si = ch, di = 0; di < sizePerCh; si += channels, ++di) {
            d[di] = s[si];
        }
        buffer.push(d);
    }
    await decoder.close();
    return { sampleRate, buffer };
}

export class RawBufferReader {
    private tmp = new Float32Array((this.sampleRate * this.bufferSizeMsec / 1000 | 0) * this.channels);
    get channels(): number { return this.src.length; }
    get length(): number { return this.src[0].length; }

    constructor(private src: Float32Array[], private sampleRate: number, private readonly bufferSizeMsec: number) {

    }

    private pos = 0;
    async seek(posSec: number): Promise<void> {
        const pos = posSec * this.sampleRate | 0;
        if (pos < 0 || pos > this.length) {
            throw new RangeError('index out of range');
        }
        this.pos = pos;
    }

    async tell(): Promise<number> {
        return this.pos / this.sampleRate;
    }

    async read(endPosSec: number): Promise<Float32Array | null> {
        const pos = this.pos;
        const endPos = Math.min(endPosSec * this.sampleRate | 0, this.length);
        if (pos >= endPos) {
            return null;
        }
        const channels = this.channels;
        const tmp = this.tmp;
        const sizePerCh = Math.min(endPos - pos, tmp.length / channels | 0);
        const src = this.src;
        const d = new Float32Array(tmp.buffer, tmp.byteOffset, sizePerCh * channels);
        for (let ch = 0; ch < channels; ++ch) {
            const s = new Float32Array(src[ch].buffer, src[ch].byteOffset + this.pos * 4, sizePerCh);
            for (let si = 0, di = ch; si < sizePerCh; ++si, di += channels) {
                d[di] = s[si];
            }
        }
        this.pos += sizePerCh;
        return d;
    }
}

export default class Decoder {
    static async create(opusData: ArrayBuffer, bufferSizeMsec: number, targetSampleRate?: number): Promise<Decoder> {
        if (targetSampleRate === undefined) {
            targetSampleRate = getTargetSampleRate();
        }
        const wc = new Decoder();
        await wc.worker.postMessage(['init']);
        await wc.open(opusData, bufferSizeMsec, targetSampleRate);
        return wc;
    }
    private worker = new PromiseWorker(Decoder.createWorkerURL());

    private length_: number;
    get length(): number { return this.length_; }

    private channels_: number;
    get channels(): number { return this.channels_; }

    private async open(opusData: ArrayBuffer, bufferSizeMsec: number, targetSampleRate: number): Promise<void> {
        const data = await this.worker.postMessage(['open', opusData, targetSampleRate, bufferSizeMsec], []);
        if (isError(data)) {
            throw data[1];
        }
        const [, length, channels] = data as ['open', number, number];
        this.length_ = length;
        this.channels_ = channels;
    }

    async close(): Promise<void> {
        await this.worker.postMessage(['close']);
        this.worker.terminate();
    }

    async seek(pos: number): Promise<void> {
        const data = await this.worker.postMessage(['seek', pos]);
        if (isError(data)) {
            throw data[1];
        }
    }

    async tell(): Promise<number> {
        const data = await this.worker.postMessage(['tell']);
        if (isError(data)) {
            throw data[1];
        }
        const [, position] = data as ['tell', number];
        return position;
    }

    async read(endPos: number): Promise<Float32Array | null> {
        const data = await this.worker.postMessage(['read', endPos]);
        if (isError(data)) {
            throw data[1];
        }
        const [, buf] = data as ['read', ArrayBuffer | null];
        return buf ? new Float32Array(buf) : null;
    }

    async tags(): Promise<Map<string, string>> {
        const data = await this.worker.postMessage(['tags']);
        if (isError(data)) {
            throw data[1];
        }
        const [, map, vendor] = data as ['tags', Map<string, string>, string];
        return map;
    }

    async readAll(progress?: (v: number) => void): Promise<Float32Array> {
        const callback = progress ? progress : (v: number) => {};
        const data = await this.worker.postMessageWithEvent(['readAll'], {
            progress: (v: number) => callback(v),
        });
        if (isError(data)) {
            throw data[1];
        }
        const [, buf, length] = data as ['read', ArrayBuffer, number];
        return new Float32Array(buf, 0, length * this.channels_);
    }

    // -------------------------------------------------------------------

    static workerURL: string;

    static createWorkerURL(): string {
        if (Decoder.workerURL) {
            return Decoder.workerURL;
        }
        const sourceCode = `
'use strict';
var Module = {
    preRun: function () { postMessage(['init']); },
};
var xhr = new XMLHttpRequest();
xhr.open('GET', ${JSON.stringify(location.protocol + '//' + location.host + location.pathname.replace(/\/[^/]+$/, '/decoder-core.wasm'))}, false);
xhr.responseType = 'arraybuffer';
xhr.send(null);
if (xhr.status === 200) {
  Module.wasmBinary = xhr.response;
}
${require('raw-loader!../decoder/decoder-core.js')};
var _open = Module.cwrap('wc_open', 'number', ['number', 'number', 'number', 'number']);
var _close = Module.cwrap('wc_close', null, []);
var _channels = Module.cwrap('wc_channels', 'number', []);
var _buffer = Module.cwrap('wc_buffer', 'number', []);
var _read = Module.cwrap('wc_read', 'number', ['number']);
var _seek = Module.cwrap('wc_seek', 'number', ['number']);
var _tell = Module.cwrap('wc_tell', 'number', []);
var _tags = Module.cwrap('wc_tags', 'number', []);

var channels = 0, bufferPtr = null, length = 0, sampleRate = 0;

// https://gist.github.com/pascaldekloe/62546103a1576803dade9269ccf76330
function decodeUTF8(bytes) {
    var s = '', i = 0;
    while (i < bytes.length) {
        var c = bytes[i++];
        if (c > 127) {
            if (c > 191 && c < 224) {
                if (i >= bytes.length) {
                    throw 'UTF-8 decode: incomplete 2-byte sequence';
                }
                c = (c & 31) << 6;
                c |= bytes[i] & 63;
            } else if (c > 223 && c < 240) {
                if (i + 1 >= bytes.length) {
                    throw 'UTF-8 decode: incomplete 3-byte sequence';
                }
                c = (c & 15) << 12;
                c |= (bytes[i] & 63) << 6;
                c |= bytes[++i] & 63;
            } else if (c > 239 && c < 248) {
                if (i+2 >= bytes.length) {
                    throw 'UTF-8 decode: incomplete 4-byte sequence';
                }
                c = (c & 7) << 18;
                c |= (bytes[i] & 63) << 12;
                c |= (bytes[++i] & 63) << 6;
                c |= bytes[++i] & 63;
            } else {
                throw 'UTF-8 decode: unknown multibyte start 0x' + c.toString(16) + ' at index ' + (i - 1);
            }
            ++i;
        }

        if (c <= 0xffff) {
            s += String.fromCharCode(c);
        } else if (c <= 0x10ffff) {
            c -= 0x10000;
            s += String.fromCharCode(c >> 10 | 0xd800)
            s += String.fromCharCode(c & 0x3FF | 0xdc00)
        } else {
            throw 'UTF-8 decode: code point 0x' + c.toString(16) + ' exceeds UTF-16 reach';
        }
    }
    return s;
}

onmessage = function (e) {
    var taskId = e.data[0], data = e.data[1];
    switch(data[0]) {
    case 'open':
        {
            var file = data[1], rate = data[2], bufferSizeMsec = data[3];
            var ptr = Module.getMemory(file.byteLength);
            var src = new Uint8Array(file);
            var dest = new Uint8Array(Module.HEAPU8.buffer, ptr, file.byteLength);
            for (var i = 0; i < file.byteLength; ++i) {
                dest[i] = src[i];
            }
            var l = _open(dest.byteOffset, dest.byteLength, rate, bufferSizeMsec);
            if (l < 0) {
                postMessage(['error', 'cannot load file']);
                return;
            }
            var c = _channels();
            if (!c) {
                _close();
                postMessage(['error', 'cannot get number of channels']);
                return;
            }
            var p = _buffer();
            if (!p) {
                _close();
                postMessage(['error', 'cannot get pointer to the buffer']);
                return;
            }
            sampleRate = rate;
            channels = c;
            bufferPtr = p;
            length = l;
            postMessage(['open', l, channels]);
            return;
        }
    case 'close':
        {
            _close();
            channels = 0;
            bufferPtr = null;
            length = 0;
            sampleRate = 0;
            postMessage(['close']);
            return;
        }
    case 'seek':
        {
            var pos = data[1];
            if (_seek(pos) < 0) {
                postMessage(['error', 'cannot seek']);
                return;
            }
            postMessage(['seek']);
            return;
        }
    case 'tell':
        {
            var r = _tell();
            if (r < 0) {
                postMessage(['error', 'tell failed']);
                return;
            }
            postMessage(['tell', r]);
            return;
        }
    case 'read':
        {
            var endPos = data[1];
            if (!channels || !bufferPtr) {
                postMessage(['error', 'file is not open']);
                return;
            }
            var r = _read(endPos);
            if (r < 0) {
                postMessage(['error', 'read failed']);
                return;
            }
            if (r == 0) {
                postMessage(['read', null]);
                return;
            }
            var size = r * channels;
            var src = new Float32Array(Module.HEAPF32.buffer, bufferPtr, size);
            var dest = new Float32Array(size);
            for (var i = 0; i < size; ++i) {
                dest[i] = src[i];
            }
            postMessage(['read', dest.buffer], [dest.buffer]);
            return;
        }
    case 'readAll':
        {
            if (!channels || !bufferPtr) {
                postMessage(['error', 'file is not open']);
                return;
            }

            if (_seek(0) < 0) {
                postMessage(['error', 'seek failed']);
                return;
            }
            var d = new Float32Array(Math.ceil(length * sampleRate) * channels | 0);
            var di = 0;
            var t = Date.now();
            for (;;) {
                var r = _read(length);
                if (r < 0) {
                    postMessage(['error', 'read failed']);
                    return;
                }
                if (r == 0) {
                    postMessage(['read', d.buffer, di / channels | 0]);
                    return;
                }
                var size = r * channels;
                var s = new Float32Array(Module.HEAPF32.buffer, bufferPtr, size);
                for (var si = 0; si < size; ++si, ++di) {
                    d[di] = s[si];
                }
                if (Date.now() - t > 100) {
                    postMessage([taskId, 'progress', di/d.length]);
                    t += 100;
                }
            }

        }
    case 'tags':
        {
            var ptr = _tags();
            if (ptr == 0) {
                postMessage(['error', 'cannot get tags']);
                return;
            }
            var opusTags = new Uint32Array(Module.HEAPU32.buffer, ptr, 16);
            var n = opusTags[2];
            var strs = new Uint32Array(Module.HEAPU32.buffer, opusTags[0], n);
            var lens = new Int32Array(Module.HEAPU32.buffer, opusTags[1], n);
            var vendor = Module.UTF8ToString(opusTags[3]);
            var r = new Map(), str, eq;
            for (var i = 0; i < n; ++i) {
                try {
                    str = decodeUTF8(new Uint8Array(Module.HEAPU32.buffer, strs[i], lens[i]));
                } catch(e) {
                    str = '';
                }
                eq = str.indexOf('=');
                if (eq == -1) {
                    continue;
                }
                r.set(str.substring(0, eq).toUpperCase(), str.substring(eq+1));
            }
            postMessage(['tags', r, vendor]);
            return;
        }
    }
};`;
        Decoder.workerURL = URL.createObjectURL(new Blob([sourceCode], { type: 'text/javascript' }));
        return Decoder.workerURL;
    }

    static revokeWorkerURL(): void {
        if (Decoder.workerURL) {
            URL.revokeObjectURL(Decoder.workerURL);
            Decoder.workerURL = '';
        }
    }
}
