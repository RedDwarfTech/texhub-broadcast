import express, { Request, Response, Router } from 'express';

export const routerHealth: Router = express.Router();

routerHealth.get("/healthz", (req: Request, res: Response) => {
  res.send("ok");
});
