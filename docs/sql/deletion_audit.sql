-- 完全删除审计表
-- 用于记录文档完全删除的事件，帮助识别异常情况

CREATE TABLE IF NOT EXISTS tex_full_deletion_audit (
  id SERIAL PRIMARY KEY,
  doc_name VARCHAR(255) NOT NULL,
  doc_id VARCHAR(255),
  user_id VARCHAR(255),
  user_name VARCHAR(255),
  previous_content_size INTEGER NOT NULL DEFAULT 0,
  timestamp TIMESTAMP NOT NULL,
  update_hash VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 表注释
COMMENT ON TABLE tex_full_deletion_audit IS '文档完全删除事件审计表，用于记录和追踪完全删除操作';

-- 列注释
COMMENT ON COLUMN tex_full_deletion_audit.doc_name IS '文档名称';
COMMENT ON COLUMN tex_full_deletion_audit.doc_id IS '文档内部ID';
COMMENT ON COLUMN tex_full_deletion_audit.user_id IS '操作用户ID';
COMMENT ON COLUMN tex_full_deletion_audit.user_name IS '用户名';
COMMENT ON COLUMN tex_full_deletion_audit.previous_content_size IS '删除前的内容大小(字符数)';
COMMENT ON COLUMN tex_full_deletion_audit.timestamp IS '操作时间戳';
COMMENT ON COLUMN tex_full_deletion_audit.update_hash IS '更新哈希值';
COMMENT ON COLUMN tex_full_deletion_audit.created_at IS '记录创建时间';

-- 索引
CREATE INDEX IF NOT EXISTS idx_doc_name ON tex_full_deletion_audit(doc_name);
CREATE INDEX IF NOT EXISTS idx_user_id ON tex_full_deletion_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_created_at ON tex_full_deletion_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_timestamp ON tex_full_deletion_audit(timestamp);