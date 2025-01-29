import express from 'express';
export const routerMetrics = express.Router();
import client from 'prom-client';
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ gcDurationBuckets: [0.1, 0.2, 0.3] });

routerMetrics.get('/', async (req, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  try {
    let metricsPromise = client.register.metrics()
    const metricsString = await metricsPromise
    const metricsBuffer = Buffer.from(metricsString)
    response.end(metricsBuffer)
  } catch (e) {
    console.error('get metrics error', e)
    response.end('metrics default')
  }
})