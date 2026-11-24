CREATE TABLE IF NOT EXISTS public.note_templates (
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  area_slug text,
  default_title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  CONSTRAINT note_templates_pkey PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS note_templates_user_position_idx
  ON public.note_templates (user_id, position);

ALTER TABLE public.note_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their note templates"
  ON public.note_templates FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their note templates"
  ON public.note_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their note templates"
  ON public.note_templates FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their note templates"
  ON public.note_templates FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_templates TO authenticated;

CREATE TABLE IF NOT EXISTS public.note_template_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.note_template_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their note template settings"
  ON public.note_template_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their note template settings"
  ON public.note_template_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their note template settings"
  ON public.note_template_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.note_template_settings TO authenticated;
