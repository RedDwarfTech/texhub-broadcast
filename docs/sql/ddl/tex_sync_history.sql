CREATE TABLE public.tex_sync_history (
	id int8 GENERATED ALWAYS AS IDENTITY( INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
	"key" varchar NOT NULL,
	value bytea NOT NULL,
	"version" varchar NOT NULL,
	content_type varchar NOT NULL,
	doc_name varchar NOT NULL,
	clock int4 NOT NULL,
	"source" varchar NOT NULL,
	created_time timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	project_id varchar NOT NULL,
	CONSTRAINT tex_sync_history_unique UNIQUE (key)
);