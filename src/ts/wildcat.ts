import * as event from './eventdispatcher';
import Decoder, { isDeviceFastEnough, decodeAll, RawBufferReader } from './decoder';
import CircularBuffer from './circularbuffer';
import SongStructure, { tomlToSongStructure } from './songstructure';
import Scheduler, * as scheduler from './scheduler';
import Mermaid from './mermaid';

export { Wildcat };
const decoderCoreBufferSizeMsec = 120;

interface DecoderInterface {
    seek(posSec: number): Promise<void>;
    tell(): Promise<number>;
    read(endPosSec: number): Promise<Float32Array | null>;
    length: number;
    channels: number;
}

export default class Wildcat {
    private decoder_: DecoderInterface | null = null;
    tags: Map<string, string>;

    private readonly sufficientBufferSize = this.bufferSize * 3;
    private buffer_: CircularBuffer | null = null;
    get remain(): number {
        if (!this.buffer_) {
            throw new Error('file is not opened yet');
        }
        return this.buffer_.remain / this.buffer_.samples;
    }

    private scheduler_: Scheduler | null = null;
    private mermaid: Mermaid | null = null;
    get scheduler(): Scheduler {
        if (!this.scheduler_) {
            throw new Error('file is not opened yet');
        }
        return this.scheduler_;
    }
    get activeNode(): scheduler.Node {
        if (!this.mermaid) {
            throw new Error('file is not opened yet');
        }
        return this.mermaid.activeNode;
    }

    private scriptNode_: ScriptProcessorNode | null = null;
    private readonly gainNode_ = this.audioCtx.createGain();
    get node(): GainNode { return this.gainNode_; }

    private startAt: number;
    private eventAt: number;
    private pausedOffset: number = 0;
    get currentTime(): number {
        return this.audioCtx.currentTime - this.startAt;
    }
    private eventQueue: [number, scheduler.Link][] = [];
    private eventDispatcher = new event.Dispatcher();

    addEventListener(type: 'queued' | 'jumped', f: (e: event.Event) => void): void {
        this.eventDispatcher.add(type, f);
    }

    removeEventListener(type: 'queued' | 'jumped', f: (e: event.Event) => void): void {
        this.eventDispatcher.remove(type, f);
    }

    private fireQueued(link: scheduler.Link): void {
        this.eventDispatcher.dispatch(new event.Event('queued', this, link));
    }

    private fireJumped(link: scheduler.Link): void {
        this.eventDispatcher.dispatch(new event.Event('jumped', this, link));
    }

    constructor(public readonly audioCtx: AudioContext, public readonly bufferSize: number, private readonly flowContainer: Element) {

    }

    get opened(): boolean { return !!this.decoder_; }
    async open(opus: ArrayBuffer, ss?: string, progress?: (v: number) => void): Promise<void> {
        const decoder = this.decoder_ = await Decoder.create(opus, decoderCoreBufferSizeMsec);
        this.buffer_ = new CircularBuffer(
            this.sufficientBufferSize + (this.audioCtx.sampleRate * decoderCoreBufferSizeMsec / 1000 | 0),
            this.decoder_.channels
        );

        this.tags = await decoder.tags();
        if (!ss) {
            ss = this.tags.get('WILDCAT');
        }
        const o = ss ? tomlToSongStructure(ss) : null;
        this.scheduler_ = new Scheduler(o ? o : [{ id: 'a', label: 'from beginning to end', start: 0, length: decoder.length, link: { a: 1 } }] as SongStructure[]);
        this.mermaid = await Mermaid.create(this.flowContainer, this.scheduler_);
        this.mermaid.addEventListener('dblclick', e => this.jump(e.value));
        if (!await isDeviceFastEnough()) {
            const r = await decodeAll(opus, progress);
            this.decoder_ = new RawBufferReader(r.buffer, r.sampleRate, decoderCoreBufferSizeMsec);
        }
    }

    async close(): Promise<void> {

    }

    get playing(): boolean { return !!this.scriptNode_; }
    get buffering(): boolean { return this.charging; }
    play(): Promise<void> {
        const offset = this.pausedOffset;
        this.pausedOffset = 0;
        return this.start(offset);
    }

    pause() {
        if (!this.buffer_) {
            throw new Error('file is not opened yet');
        }
        if (this.scriptNode_) {
            this.scriptNode_.disconnect(this.gainNode_);
            this.scriptNode_ = null;
        }
        this.pausedOffset = this.audioCtx.currentTime - this.eventAt;
        this.stopFiller();
        this.buffer_.reset();
        this.eventQueue = [];
    }

    stop() {
        if (!this.buffer_) {
            throw new Error('file is not opened yet');
        }
        if (this.scriptNode_) {
            this.scriptNode_.onaudioprocess = () => undefined;
            this.scriptNode_.disconnect(this.gainNode_);
            this.scriptNode_ = null;
        }
        this.pausedOffset = 0;
        this.stopFiller();
        this.buffer_.reset();
        this.eventQueue = [];
    }

    async jump(node: scheduler.Node): Promise<void> {
        if (!this.scheduler_ || !this.mermaid) {
            throw new Error('file is not opened yet');
        }
        const playing = this.playing;
        this.stop();
        this.scheduler_.currentNode = node;
        this.mermaid.activeNode = node;
        this.pausedOffset = 0;
        if (playing) {
            return this.start(0);
        }
    }

    private async start(offset: number): Promise<void> {
        if (!this.scheduler_ || !this.decoder_) {
            throw new Error('file is not opened yet');
        }
        await this.decoder_.seek(this.scheduler_.currentNode.start + offset);
        this.startFiller();
        await this.waitFill();
        this.bufferUnderRun = 0;
        this.scriptNode_ = this.audioCtx.createScriptProcessor(this.bufferSize, 0, this.decoder_.channels);
        this.scriptNode_.connect(this.gainNode_);
        this.scriptNode_.onaudioprocess = e => {
            this.startAt = e.playbackTime;
            this.eventAt = e.playbackTime - offset;
            (e.target as ScriptProcessorNode).onaudioprocess = e => this.processAudio(e);
            this.processAudio(e);
        }
    }

    private fillRest(data: Float32Array[], length: number) {
        for (let ch = 0; ch < data.length; ++ch) {
            const o = data[ch];
            for (let i = o.length - length; i < o.length; ++i) {
                o[i] = 0;
            }
        }
    }

    private bufferUnderRun = 0;
    private processAudio(e: AudioProcessingEvent) {
        const out = e.outputBuffer;
        const dest = [];
        for (let ch = 0; ch < out.numberOfChannels; ++ch) {
            dest.push(out.getChannelData(ch));
        }
        if (!this.playing || this.charging || !this.buffer_) {
            this.fillRest(dest, out.length);
            return;
        }
        if (this.buffer_.remain < out.length) {
            ++this.bufferUnderRun;
            this.fillRest(dest, out.length);
            this.eventAt += out.length / out.sampleRate;
            return;
        }
        const r = this.buffer_.read(dest);
        if (out.length != r) {
            ++this.bufferUnderRun;
            this.fillRest(dest, out.length - r);
            this.eventAt += (out.length - r) / out.sampleRate;
            return;
        }
    }

    private watcher() {
        if (!this.mermaid || !this.scheduler_) {
            throw new Error('file is not opened yet');
        }
        if (!this.eventQueue.length) {
            return;
        }
        const [length, link] = this.eventQueue[0];
        if (this.audioCtx.currentTime < this.eventAt + length) {
            return;
        }
        this.mermaid.activeNode = this.scheduler_.nodes[link.to];
        this.eventAt += length;
        this.fireJumped(link);
        this.eventQueue.shift();
    }

    private fillerTimer = 0;
    private startFiller() {
        this.fill();
    }

    private async fill(): Promise<void> {
        if (!this.decoder_ || !this.buffer_ || !this.scheduler_) {
            throw new Error('file is not opened yet');
        }
        const sc = this.scheduler_;
        const buffer = this.buffer_;
        const decoder = this.decoder_;
        for (; ;) {
            this.watcher();
            if (buffer.remain >= this.sufficientBufferSize) {
                this.fillerTimer = setTimeout(() => this.fill(), 32);
                break;
            }
            const pcm = await decoder.read(sc.currentNode.start + sc.currentNode.length);
            if (pcm) {
                buffer.writeInterleaved(pcm);
                continue;
            }
            sc.next();
            this.eventQueue.push([sc.currentNode.length, sc.latestUsedLink!]);
            this.fireQueued(sc.latestUsedLink!);
            await decoder.seek(sc.currentNode.start);
        }
    }

    private stopFiller() {
        if (this.fillerTimer) {
            clearTimeout(this.fillerTimer);
            this.fillerTimer = 0;
        }
    }

    private charging = false;
    private async waitFill(): Promise<void> {
        if (!this.buffer_) {
            throw new Error('file is not opened yet');
        }
        this.charging = true;
        while (this.buffer_.remain < this.sufficientBufferSize) {
            await delay(16);
        }
        this.charging = false;
    }
}

function delay(msec: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(() => resolve(), msec));
}
