// 全局 HTTP Range 请求调度器（单例）
// 所有 WIL 库共享并发额度。可见地图/实体优先，离屏预取低优先级。
// 对进行中或等待中的覆盖范围请求去重，释放的并发额度立即交给高优先级请求。

const MAX_CONCURRENT = 20;

export class RangeScheduler {
    constructor(maxConcurrent = MAX_CONCURRENT) {
        this.maxConcurrent = Math.max(1, Number(maxConcurrent) || MAX_CONCURRENT);
        this.active = [];   // {url,start,end,consumers}
        this.queue = [];    // {url,start,end,priority,sequence,consumers}
        this.sequence = 0;
        this.totalRequests = 0;
        this.dedupedRequests = 0;
        this.peakActive = 0;
    }

    /**
     * 调度一个字节范围请求。
     * Priority 越大越先开始；同优先级按进入队列顺序执行。
     * @returns {Promise<{start:number,buffer:ArrayBuffer,total:number}>}
     */
    schedule(url, start, end, priority = 10) {
        const requestPriority = Number.isFinite(Number(priority)) ? Number(priority) : 10;
        const consumer = { start, end, resolve: null, reject: null };

        // 1. 已经在下载的覆盖请求：挂接消费者，不额外占用并发额度。
        for (const active of this.active) {
            if (active.url === url && active.start <= start && start < active.end) {
                this.dedupedRequests++;
                return new Promise((resolve, reject) => {
                    active.consumers.push({ ...consumer, resolve, reject });
                });
            }
        }

        // 2. 已在队列等待的覆盖请求：合并消费者，并提升到更高优先级。
        for (const queued of this.queue) {
            if (queued.url === url && queued.start <= start && start < queued.end) {
                this.dedupedRequests++;
                queued.priority = Math.max(queued.priority, requestPriority);
                const promise = new Promise((resolve, reject) => {
                    queued.consumers.push({ ...consumer, resolve, reject });
                });
                this._sortQueue();
                this._pump();
                return promise;
            }
        }

        // 3. 新请求入优先级队列。
        const promise = new Promise((resolve, reject) => {
            this.queue.push({
                url, start, end,
                priority: requestPriority,
                sequence: this.sequence++,
                consumers: [{ ...consumer, resolve, reject }],
            });
            this._sortQueue();
            this._pump();
        });
        return promise;
    }

    _sortQueue() {
        this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    }

    _pump() {
        while (this.active.length < this.maxConcurrent && this.queue.length > 0) {
            this._start(this.queue.shift());
        }
    }

    _start(request) {
        const item = {
            url: request.url,
            start: request.start,
            end: request.end,
            consumers: request.consumers,
        };
        this.active.push(item);
        this.peakActive = Math.max(this.peakActive, this.active.length);
        this.totalRequests++;

        fetch(item.url, {
            headers: { Range: `bytes=${item.start}-${item.end}` },
        })
            .then(response => {
                if (!response.ok && response.status !== 206) {
                    throw new Error(`HTTP ${response.status}`);
                }
                let total = 0;
                const contentRange = response.headers.get('content-range');
                if (contentRange) {
                    const match = contentRange.match(/\/(\d+)\s*$/);
                    if (match) total = parseInt(match[1], 10);
                }
                return response.arrayBuffer().then(buffer => ({ buffer, total }));
            })
            .then(({ buffer, total }) => {
                for (const consumer of item.consumers) {
                    consumer.resolve({ start: item.start, buffer, total });
                }
            })
            .catch(error => {
                for (const consumer of item.consumers) consumer.reject(error);
            })
            .finally(() => {
                const index = this.active.indexOf(item);
                if (index >= 0) this.active.splice(index, 1);
                this._pump();
            });
    }

    stats() {
        return {
            active: this.active.length,
            queue: this.queue.length,
            total: this.totalRequests,
            deduped: this.dedupedRequests,
            peakActive: this.peakActive,
        };
    }
}

export const scheduler = new RangeScheduler();
