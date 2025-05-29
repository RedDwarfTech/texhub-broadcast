import { Model, DataTypes } from 'sequelize';
import { sequelize } from '@/storage/adapter/postgresql/conf/sequelize.js';

export interface ProjectScrollVersionAttributes {
  id: number;
  key: string;
  value: Buffer | null;
  version: string | null;
  content_type: string | null;
  doc_name: string | null;
  clock: number | null;
  source: string | null;
  created_time: Date;
  project_id: string;
}

export class ProjectScrollVersion extends Model<ProjectScrollVersionAttributes> implements ProjectScrollVersionAttributes {
  public id!: number;
  public key!: string;
  public value!: Buffer | null;
  public version!: string | null;
  public content_type!: string | null;
  public doc_name!: string | null;
  public clock!: number | null;
  public source!: string | null;
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
      allowNull: true,
    },
    version: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    content_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    doc_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    clock: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
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