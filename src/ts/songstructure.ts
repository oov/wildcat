import * as toml from 'toml';

export default interface SongStructure {
    id: string;
    label: string;
    start: number;
    length: number;
    link: {
        [otherId: string]: number;
    };
};

export function isSongStructure(x: any, skipId: boolean): x is SongStructure {
    if (!x) {
        return false;
    }
    if (!skipId && typeof x.id !== 'string') {
        return false;
    }
    if (typeof x.label !== 'string') {
        return false;
    }
    if (typeof x.start !== 'number') {
        return false;
    }
    if (typeof x.length !== 'number') {
        return false;
    }
    if (!x.link) {
        return false;
    }
    for (const key of Object.keys(x.link)) {
        if (typeof key !== 'string') {
            return false;
        }
        if (typeof x.link[key] !== 'number') {
            return false;
        }
    }
    return true;
}

export function isSongStructureArray(x: any): x is SongStructure[] {
    if (!Array.isArray(x)) {
        return false;
    }
    for(const elem of x) {
        if (!isSongStructure(elem, false)) {
            return false;
        }
    }
    return true;
}

export function tomlToSongStructure(s: string): SongStructure[] | null {
    let x: any;
    try { x = toml.parse(s); } catch(e) {}
    if (!x) {
        return null;
    }
    const r: SongStructure[] = [];
    for (const key of Object.keys(x)) {
        const item = x[key];
        if (!item || !isSongStructure(item, true)) {
            return null;
        }
        item.id = key;
        r.push(item);
    }
    return r;
}