-- public.tex_sync_history definition

-- Drop table

-- DROP TABLE public.tex_sync_history;

CREATE TABLE public.tex_sync_history (
	id int8 GENERATED ALWAYS AS IDENTITY( INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
	"key" varchar NOT NULL,
	value bytea NULL,
	"version" varchar NULL,
	content_type varchar NULL,
	doc_name varchar NULL,
	clock int4 NULL,
	"source" varchar NULL,
	created_time timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	project_id varchar NOT NULL,
	CONSTRAINT tex_sync_history_unique UNIQUE (key)
);



