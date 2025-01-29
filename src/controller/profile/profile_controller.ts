export const routerProfile = express.Router();
import fs from 'fs';
import v8 from 'v8';
import express, { Request, Response } from "express";

routerProfile.get('/dump', (req: Request, res: Response) => {
  const snapshotStream = v8.getHeapSnapshot()
  const now = new Date()
  const fileAttri = `${now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}`
  // It's important that the filename end with `.heapsnapshot`,
  // otherwise Chrome DevTools won't open it.
  const fileName = `/opt/data/y-websocket-dump/${fileAttri}.heapsnapshot`
  const fileStream = fs.createWriteStream(fileName)
  snapshotStream.pipe(fileStream)
  res.send('ok')
});

routerProfile.get('/heap', (req, res) => {
  const heap = process.memoryUsage()
  const heapStr = JSON.stringify(heap)
  res.send(heapStr)
});