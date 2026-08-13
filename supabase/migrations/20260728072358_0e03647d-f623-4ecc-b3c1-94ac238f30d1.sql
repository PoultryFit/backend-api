-- Feed products: commercial bagged feed (chick mash, growers mash, layers
-- mash, broiler starter/finisher, etc.) keyed by poultry type + goal +
-- growth stage, replacing the guesswork "Sample Product" placeholder data.
--
-- Data sourcing note: prices below are current Kenyan agrovet retail
-- listings (Mkulima Online, myagrovet.co.ke, Farmers Trend/Fugo, Sigma
-- Feeds, crazykanairofarming.com — July 2026), not in-person county-level
-- field surveys. They represent a reasonable national baseline
-- (county = NULL) until the team's own field-collected agrovet price
-- data is available to override/supplement per county.
--
-- Turkey, goose, quail, and guinea fowl are intentionally NOT seeded with
-- distinct product rows: no dedicated commercial feed products for these
-- birds were found in the Kenyan retail market. The application should
-- fall back to the closest chicken-goal equivalent (meat goal -> broiler
-- products, eggs/dual goal -> layer/kienyeji products) for these types.

CREATE TABLE public.feed_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poultry_type TEXT NOT NULL,      -- 'chicken' | 'duck' (see note above for others)
  goal TEXT NOT NULL,              -- 'eggs' | 'meat' | 'dual'
  stage TEXT NOT NULL,             -- 'chick' | 'grower' | 'layer'
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'feed',
  brand TEXT,
  unit_size TEXT NOT NULL DEFAULT '50 kg',
  price_kes NUMERIC NOT NULL,
  county TEXT,                     -- NULL = national baseline price
  agrovet_name TEXT,
  source TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.feed_products (poultry_type, goal, stage, county);

GRANT SELECT ON public.feed_products TO anon, authenticated;
GRANT ALL ON public.feed_products TO service_role;

ALTER TABLE public.feed_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read feed_products" ON public.feed_products
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admin write feed_products" ON public.feed_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Chicken / Eggs (layer path)
INSERT INTO public.feed_products (poultry_type, goal, stage, product_name, brand, price_kes, source, notes) VALUES
  ('chicken', 'eggs', 'chick',  'Chick Mash',    NULL,  3900, 'Mkulima Online, Jul 2026', '0-8 weeks'),
  ('chicken', 'eggs', 'grower', 'Growers Mash',  NULL,  4075, 'Mkulima Online / Sigma Feeds, Jul 2026', '9-18 weeks; avg of 3950-4200 range'),
  ('chicken', 'eggs', 'layer',  'Layers Mash',   'Sigma', 3900, 'Sigma Feeds / Mkulima Online, Jul 2026', 'Point-of-lay onward');

-- Chicken / Meat (broiler path) — mapped chick=starter, grower=finisher
INSERT INTO public.feed_products (poultry_type, goal, stage, product_name, brand, price_kes, source, notes) VALUES
  ('chicken', 'meat', 'chick',  'Broiler Starter Crumbs',  'Fugo', 4740, 'crazykanairofarming.com / myagrovet.co.ke, Jul 2026', '0-3 weeks; avg of 4600-4880 range'),
  ('chicken', 'meat', 'grower', 'Broiler Finisher Pellets', 'Fugo', 4268, 'myagrovet.co.ke / crazykanairofarming.com, Jul 2026', '4-6 weeks; avg of 4070-4465 range');

-- Chicken / Dual (kienyeji path)
INSERT INTO public.feed_products (poultry_type, goal, stage, product_name, brand, price_kes, source, notes) VALUES
  ('chicken', 'dual', 'chick',  'Chick Mash',            NULL,  3900, 'Mkulima Online, Jul 2026', '0-8 weeks, shared with layer chick mash'),
  ('chicken', 'dual', 'grower', 'Kienyeji Growers Mash', 'Fugo', 3400, 'myagrovet.co.ke, Jul 2026', '9-18 weeks'),
  ('chicken', 'dual', 'layer',  'Kienyeji Mash',         NULL,  3500, 'Mkulima Online, Jul 2026', 'From ~10% point-of-lay onward');

-- Duck — no dedicated grower/layer products exist; falls back to standard
-- chicken growers/layers mash, noted explicitly per row.
INSERT INTO public.feed_products (poultry_type, goal, stage, product_name, brand, price_kes, source, notes) VALUES
  ('duck', 'eggs', 'chick',  'Chick & Duckling Mash', 'Fugo', 4155, 'Farmers Trend / myagrovet.co.ke, Jul 2026', '0-8 weeks, shared product with layer chicks'),
  ('duck', 'eggs', 'grower', 'Growers Mash',          NULL,  4075, 'Mkulima Online / Sigma Feeds, Jul 2026', 'No dedicated duck grower product; standard growers mash'),
  ('duck', 'eggs', 'layer',  'Layers Mash',           'Sigma', 3900, 'Sigma Feeds / Mkulima Online, Jul 2026', 'No dedicated duck layer product; standard layers mash'),
  ('duck', 'meat', 'chick',  'Chick & Duckling Mash', 'Fugo', 4155, 'Farmers Trend / myagrovet.co.ke, Jul 2026', '0-8 weeks'),
  ('duck', 'meat', 'grower', 'Growers Mash',          NULL,  4075, 'Mkulima Online / Sigma Feeds, Jul 2026', 'No dedicated duck finisher product; standard growers mash'),
  ('duck', 'dual', 'chick',  'Chick & Duckling Mash', 'Fugo', 4155, 'Farmers Trend / myagrovet.co.ke, Jul 2026', '0-8 weeks'),
  ('duck', 'dual', 'grower', 'Growers Mash',          NULL,  4075, 'Mkulima Online / Sigma Feeds, Jul 2026', 'No dedicated duck grower product'),
  ('duck', 'dual', 'layer',  'Layers Mash',           'Sigma', 3900, 'Sigma Feeds / Mkulima Online, Jul 2026', 'No dedicated duck layer product');
