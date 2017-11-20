import Scheduler, * as scheduler from './scheduler';
import * as event from './eventdispatcher';
import 'mermaid';
declare var mermaidAPI: {
    initialize: (options: any) => void;
    render: (svgId: string, script: string, callback: (svgCode: string, bind: Function) => void) => void;
};
mermaidAPI.initialize({ startOnLoad: false });

const requestAnimationFrame: (callback: FrameRequestCallback) => number =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    (window as any).mozRequestAnimationFrame ||
    (window as any).oRequestAnimationFrame ||
    (window as any).msRequestAnimationFrame ||
    (callback => setTimeout(() => callback(Date.now()), 1000 / 60));
const cancelAnimationFrame: (handle: number) => void =
    window.cancelAnimationFrame ||
    window.webkitCancelAnimationFrame ||
    (window as any).mozCancelAnimationFrame ||
    (window as any).oCancelAnimationFrame ||
    (window as any).msCancelAnimationFrame ||
    (handle => clearTimeout(handle));

export default class Mermaid {
    public static create(container: Element, sc: Scheduler): Promise<Mermaid> {
        return renderMermaid(sc.flow, container).then(elem => new Mermaid(elem, sc));
    }

    private nodes = this.container.querySelectorAll('.nodes .node');
    private links = this.container.querySelectorAll('.edgePaths .edgePath');

    private activeNode_ = this.scheduler.currentNode;
    private timerId = 0;
    get activeNode(): scheduler.Node { return this.activeNode_; }
    set activeNode(n: scheduler.Node) {
        if (this.timerId) {
            cancelAnimationFrame(this.timerId);
            this.timerId = 0;
        } else {
            for (let i = 0; i < this.links.length; ++i) {
                this.links[i].classList.remove('active', 'candidate', 'reserved');
            }
            for (let i = 0; i < this.nodes.length; ++i) {
                this.nodes[i].classList.remove('active', 'candidate', 'reserved');
            }
        }
        this.activeNode_ = n;

        // we need 2 frames to reset css animation
        this.timerId = requestAnimationFrame(() => {
            this.timerId = requestAnimationFrame(() => {
                this.timerId = 0;
                this.nodes[this.activeNode_.index].classList.add('active');
                n.link.forEach(l => {
                    this.links[l.index].classList.add('candidate');
                    this.nodes[l.to].classList.add('candidate');
                });
                if (this.scheduler.reservedLink) {
                    const l = this.scheduler.reservedLink;
                    this.links[l.index].classList.add('reserved');
                    this.nodes[l.to].classList.add('reserved');
                }
            });
        });
    }

    private nodeOnClick(e: Event) {
        const elem = e.currentTarget as Element;
        if (!elem.classList.contains('candidate')) {
            return;
        }
        const n = parseInt(elem.getAttribute('data-wc-index') || '-1', 10);
        const links = this.activeNode_.link;
        for (let i = 0; i < links.length; ++i) {
            if (links[i].to === n) {
                this.scheduler.reserve(links[i]);
                this.activeNode = this.activeNode;
                break;
            }
        }
    }

    private nodeOnDblClick(e: Event) {
        const elem = e.currentTarget as Element;
        const n = parseInt(elem.getAttribute('data-wc-index') || '-1', 10);
        this.fireDblClick(this.scheduler.nodes[n]);
    }

    constructor(private container: Element, private scheduler: Scheduler) {
        for (let i = 0; i < this.links.length; ++i) {
            this.links[i].removeAttribute('style');
            this.links[i].setAttribute('data-wc-index', i.toString());
        }
        for (let i = 0; i < this.nodes.length; ++i) {
            this.nodes[i].removeAttribute('style');
            this.nodes[i].setAttribute('data-wc-index', i.toString());
            this.nodes[i].addEventListener('click', e => this.nodeOnClick(e));
            this.nodes[i].addEventListener('dblclick', e => this.nodeOnDblClick(e));
        }
        this.activeNode_ = scheduler.currentNode;
        this.activeNode = scheduler.currentNode;
    }

    private eventDispatcher = new event.Dispatcher();

    addEventListener(type: 'dblclick', f: (e: event.Event) => void): void {
        this.eventDispatcher.add(type, f);
    }

    removeEventListener(type: 'dblclick', f: (e: event.Event) => void): void {
        this.eventDispatcher.remove(type, f);
    }

    private fireDblClick(node: scheduler.Node): void {
        this.eventDispatcher.dispatch(new event.Event('dblclick', this, node));
    }

}

function renderMermaid(script: string, container: Element): Promise<Element> {
    return new Promise<Element>(resolve => {
        container.innerHTML = '';
        mermaidAPI.render('mermaid' + Math.random().toString().substring(2), script, (svgCode, bind) => {
            container.innerHTML = svgCode;
            resolve(container);
        });
    });
}
