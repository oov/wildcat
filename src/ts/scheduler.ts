import SongStructure from './songstructure';
import XorShift from './xorshift';

export interface Link {
    readonly to: number;
    readonly index: number;
    readonly weight: number;
}

export class Node {
    readonly index: number;
    readonly id: string;
    readonly label: string;
    readonly start: number;
    readonly length: number;
    readonly link: Link[] = [];
    getLink(f: number): Link | null {
        const totalWeight = this.link.reduce((v,l) => v + l.weight, 0);
        const v = f * totalWeight;
        let n = 0;
        for (const l of this.link) {
            n += l.weight;
            if (v < n) {
                return l;
            }
        }
        return null;
    }
    constructor(ss: SongStructure, index: number) {
        this.index = index;
        this.id = ss.id;
        this.label = ss.label;
        this.start = ss.start;
        this.length = ss.length;
    }
}

export default class Scheduler {
    private lastUsedSeed_: number;
    get lastUsedSeed(): number { return this.lastUsedSeed_; }
    private readonly rng = new XorShift();

    public readonly nodes: Node[] = [];
    public readonly flow: string;

    private currentNode_: Node;
    set currentNode(n: Node) {
        this.prevNode_ = this.currentNode_;
        this.currentNode_ = n;
        this.reservedLink_ = null;
        this.latestUsedLink_ = null;
        this.setSeed();
    }
    get currentNode(): Node { return this.currentNode_; };
    private prevNode_: Node;
    get prevNode(): Node { return this.prevNode_; };

    private reservedLink_: Link | null;
    get reservedLink(): Link | null { return this.reservedLink_; };
    private latestUsedLink_: Link | null;
    get latestUsedLink(): Link | null { return this.latestUsedLink_; };

    private findFirstNode(): Node {
        let first = null, t = Number.MAX_VALUE;
        this.nodes.forEach((item, idx) => {
            if (item.start < t) {
                first = item;
                t = item.start;
            }
        });
        if (!first) {
            throw new Error('you must have at least one node');
        }
        return first;
    }

    constructor(ss: SongStructure[]) {
        const flow: string[] = ['graph TB'];
        const tmpMap = new Map<string, number>();

        ss.forEach((item, idx) => {
            this.nodes.push(new Node(item, idx));
            tmpMap.set(item.id, idx);
            flow.push(`node${idx}["${item.label.replace(/"/g, '#quot;')}"]`);
        });

        let linkIdx = 0;
        ss.forEach((item, idx) => {
            Object.keys(item.link).forEach(otherId => {
                const n = this.nodes[idx];
                const otherIdx = tmpMap.get(otherId);
                if (n === undefined || otherIdx === undefined) {
                    console.warn(`link ${JSON.stringify(item.id)} -> ${JSON.stringify(otherId)} is broken. it has been removed.`);
                    return;
                }
                n.link.push({to: otherIdx, index: linkIdx++, weight: item.link[otherId]});
                flow.push(`node${idx} --> node${otherIdx}`);
            });
        });

        const n = this.findFirstNode();
        this.currentNode_ = n;
        this.prevNode_ = n;
        this.flow = flow.join('\n');
        this.setSeed();
    }

    setSeed(v?: number): void {
        this.lastUsedSeed_ = v === undefined ? Math.random() * 4294967295.0 | 0 : v;
        this.rng.setSeed(this.lastUsedSeed_);
    }

    reserve(l: Link): void {
        this.reservedLink_ = l;
    }

    next(): void {
        if (!this.reservedLink_) {
            this.reservedLink_ = this.currentNode.getLink(this.rng.next());
            if (!this.reservedLink_) {
                return; // nothing anymore
            }
        }
        this.prevNode_ = this.currentNode_;
        this.latestUsedLink_ = this.reservedLink_;
        this.currentNode_ = this.nodes[this.reservedLink_.to];
        this.reservedLink_ = null;
    }
}