import express, { Request, Response } from 'express';

export const routerHealth = express.Router();

routerHealth.get("/healthz", (req: Request, res: Response) => {
  res.send("ok");
});
