import { Model, DataTypes } from 'sequelize';
import { sequelize } from '@/storage/adapter/postgresql/conf/sequelize.js';

export interface ProjectScrollVersionAttributes {
  id: number;
  key: string;
  value: Buffer;
  version: string;
  content_type: string;
  doc_name: string;
  clock: number;
  source: string;
  created_time: Date;
  project_id: string;
}

export class ProjectScrollVersion extends Model<ProjectScrollVersionAttributes> implements ProjectScrollVersionAttributes {
  public id!: number;
  public key!: string;
  public value!: Buffer;
  public version!: string;
  public content_type!: string;
  public doc_name!: string;
  public clock!: number;
  public source!: string;
  public created_time!: Date;
  public project_id!: string;
}

ProjectScrollVersion.init(
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
    value: {
      type: DataTypes.BLOB,
      allowNull: false,
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
  },
  {
    sequelize,
    tableName: 'tex_sync_history',
    timestamps: false,
  }
); 