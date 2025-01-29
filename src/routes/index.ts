import { Express, Request, Response, Router } from 'express';
import { routerHealth } from '../controller/health/health_controller';

interface RouterConf {
  path: string,
  router: Router,
  meta?: any
}

const routerConf: Array<RouterConf> = [];

function routes(app: Express) {
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).send('Hello Shinp!!!');
  });
  app.use('/health', routerHealth);
  routerConf.forEach((conf) => app.use(conf.path, conf.router));
}

export default routes