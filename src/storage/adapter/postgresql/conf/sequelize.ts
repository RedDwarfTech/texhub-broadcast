import { dbConfig } from './db_config.js';

let Sequelize: any;
let sequelize: any = undefined;

if (typeof window === 'undefined') {
  Sequelize = (await import('sequelize')).Sequelize;
  sequelize = new Sequelize({
    dialect: 'postgres',
    host: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
}

export { sequelize }; 