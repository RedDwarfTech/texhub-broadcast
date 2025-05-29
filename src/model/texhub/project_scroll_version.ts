import { Model, DataTypes } from 'sequelize';
import { sequelize } from '@/storage/adapter/postgresql/conf/pg_base.js';

export interface ProjectScrollVersionAttributes {
  id: number;
  project_id: string;
  version: number;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export class ProjectScrollVersion extends Model<ProjectScrollVersionAttributes> implements ProjectScrollVersionAttributes {
  public id!: number;
  public project_id!: string;
  public version!: number;
  public content!: string;
  public created_at!: Date;
  public updated_at!: Date;
}

ProjectScrollVersion.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    project_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'project_scroll_version',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
); 