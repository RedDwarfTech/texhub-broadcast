import { Worker } from "node:worker_threads";

export const runWorker = (workerData: any) => {
    return new Promise((resolve, reject) => {
        const worker = new Worker('./sync_to_pg.js', { workerData });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0)
                reject(new Error(`stopped with  ${code} exit code`));
        })
    })
};

