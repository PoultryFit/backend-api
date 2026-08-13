
CREATE TABLE public.feed_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  energy_kcal NUMERIC NOT NULL,
  protein_pct NUMERIC NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feed_ingredients TO anon, authenticated;
GRANT ALL ON public.feed_ingredients TO service_role;

ALTER TABLE public.feed_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Feed ingredients are viewable by everyone"
  ON public.feed_ingredients FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert feed ingredients"
  ON public.feed_ingredients FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update feed ingredients"
  ON public.feed_ingredients FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete feed ingredients"
  ON public.feed_ingredients FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.feed_ingredients (slug, name, category, energy_kcal, protein_pct) VALUES
  ('maize',     'Maize germ',        'energy',  3400, 9),
  ('wheat',     'Wheat pollard',     'energy',  2600, 14),
  ('omena',     'Omena (fish meal)', 'protein', 2900, 55),
  ('soya',      'Soya meal',         'protein', 2400, 44),
  ('sunflower', 'Sunflower cake',    'protein', 2200, 30),
  ('lime',      'Limestone / DCP',   'mineral', 0,    0);
