import { Sequelize } from 'sequelize';
import { dbConfig } from './db_config.js';
import logger from '@/common/log4js_config.js';

export const sequelize = new Sequelize({
  dialect: 'postgres',
  host: dbConfig.host,
  port: dbConfig.port,
  username: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  logging: (msg) => logger.debug(msg),
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
}); 