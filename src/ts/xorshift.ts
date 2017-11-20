// https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Math/imul#Polyfill
function imulPolyfill(a: number, b: number): number {
    const ah = (a >>> 16) & 0xffff;
    const al = a & 0xffff;
    const bh = (b >>> 16) & 0xffff;
    const bl = b & 0xffff;
    // the shift by 0 fixes the sign on the high part
    // the final |0 converts the unsigned value into a signed value
    return al * bl + (((ah * bl + al * bh) << 16) >>> 0) | 0;
};
const imul = Math.imul ? Math.imul : imulPolyfill;

function toUint32(x: number): number {
    return (x & 0xffff) + ((x >>> 16) & 0xffff) * 65536.0;
}

export default class XorShift {
    private x: number;
    private y: number;
    private z: number;
    private w: number;

    constructor(seed?: number) {
        if (seed === undefined) {
            this.setSeedByTime();
        } else {
            this.setSeed(seed);
        }
    }

    setSeedByTime(): void {
        this.setSeed(Date.now());
    }

    setSeed(seed: number): void {
        const x = 1812433253;
        this.x = seed = imul(x, seed ^ (seed >>> 30)) + 1;
        this.y = seed = imul(x, seed ^ (seed >>> 30)) + 2;
        this.z = seed = imul(x, seed ^ (seed >>> 30)) + 3;
        this.w = seed = imul(x, seed ^ (seed >>> 30)) + 4;
    }

    next(): number {
        return this.nextUInt32() / 4294967295.0;
    }

    nextUInt32(): number {
        const w_ = this.w;
        const t = this.x ^ (this.x << 11);
        this.x = this.y;
        this.y = this.z;
        this.z = this.w;
        this.w = (w_ ^ w_ >>> 19) ^ (t ^ t >>> 8);
        return toUint32(this.w);
    }
}