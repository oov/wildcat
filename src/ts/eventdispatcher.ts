export class Event {
    constructor(public name: string, public currentTarget: any, public value?: any) { }
}

export class Dispatcher {
    private _listeners = new Map<string, Set<Function>>();

    add(name: string, f: Function): void {
        let s = this._listeners.get(name);
        if (s) {
            s.add(f);
            return;
        }
        s = new Set();
        s.add(f);
        this._listeners.set(name, s);
    }

    remove(name: string, f: Function): void {
        const s = this._listeners.get(name);
        if (s) {
            s.delete(f);
        }
    }

    has(name: string, f: Function): boolean {
        const s = this._listeners.get(name);
        if (!s) {
            return false;
        }
        return s.has(f);
    }

    dispatch(e: Event): void {
        const s = this._listeners.get(e.name);
        if (!s) {
            return;
        }
        s.forEach(f => {
            try {
                f(e);
            } catch (err) {
                console.error(err.stack);
            }
        });
    }
}
