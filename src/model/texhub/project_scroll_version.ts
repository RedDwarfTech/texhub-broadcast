let Model: any, DataTypes: any;
if (typeof window === "undefined") {
  const sequelizeModule = await import('sequelize');
  Model = sequelizeModule.Model;
  DataTypes = sequelizeModule.DataTypes;
}
import { sequelize } from '@/storage/adapter/postgresql/conf/sequelize.js';

export interface ProjectScrollVersionAttributes {
  id: number;
  key: string;
  version: string;
  content_type: string;
  doc_name: string;
  clock: number;
  source: string;
  created_time: Date;
  project_id: string;
  value: Buffer;
  diff: string;
  content: string;
  doc_int_id: string;
}

let ProjectScrollVersion: any = {};
if (typeof window === "undefined" && Model && DataTypes && sequelize) {
  class _ProjectScrollVersion extends Model<ProjectScrollVersionAttributes> implements ProjectScrollVersionAttributes {
    public id!: number;
    public key!: string;
    public version!: string;
    public content_type!: string;
    public doc_name!: string;
    public clock!: number;
    public source!: string;
    public created_time!: Date;
    public project_id!: string;
    public value!: Buffer;
    public diff!: string;
    public content!: string;
    public doc_int_id!: string;
  }
  _ProjectScrollVersion.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      version: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      content_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      doc_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      clock: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      created_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      project_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      value: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      diff: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      doc_int_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'tex_sync_history',
      timestamps: false,
    }
  );
  ProjectScrollVersion = _ProjectScrollVersion;
}

export { ProjectScrollVersion }; 