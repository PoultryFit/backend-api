
-- Enums
CREATE TYPE public.app_role AS ENUM ('user', 'admin');
CREATE TYPE public.vet_kind AS ENUM ('vet', 'agrovet');

-- Utility trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  county TEXT,
  sub_county TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Reference: poultry_types
CREATE TABLE public.poultry_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  space_per_bird_m2 NUMERIC NOT NULL,
  feed_g_per_day NUMERIC NOT NULL,
  water_ml_per_day NUMERIC NOT NULL,
  maturity_weeks INT NOT NULL,
  purpose TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.poultry_types TO anon, authenticated;
GRANT ALL ON public.poultry_types TO service_role;
ALTER TABLE public.poultry_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read poultry_types" ON public.poultry_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write poultry_types" ON public.poultry_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Reference: feed_prices
CREATE TABLE public.feed_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_type TEXT NOT NULL,
  brand TEXT NOT NULL,
  price_kes_per_kg NUMERIC NOT NULL,
  county TEXT,
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.feed_prices (county, feed_type);
GRANT SELECT ON public.feed_prices TO anon, authenticated;
GRANT ALL ON public.feed_prices TO service_role;
ALTER TABLE public.feed_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read feed_prices" ON public.feed_prices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write feed_prices" ON public.feed_prices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Reference: county_bylaws
CREATE TABLE public.county_bylaws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county TEXT NOT NULL,
  sub_county TEXT,
  permit_required BOOLEAN NOT NULL DEFAULT false,
  max_birds_residential INT,
  setback_meters NUMERIC,
  notes TEXT,
  source_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (county, sub_county)
);
GRANT SELECT ON public.county_bylaws TO anon, authenticated;
GRANT ALL ON public.county_bylaws TO service_role;
ALTER TABLE public.county_bylaws ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read bylaws" ON public.county_bylaws FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write bylaws" ON public.county_bylaws FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Reference: vets
CREATE TABLE public.vets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind public.vet_kind NOT NULL,
  county TEXT,
  sub_county TEXT,
  phone TEXT,
  lat NUMERIC,
  lng NUMERIC,
  services TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vets TO anon, authenticated;
GRANT ALL ON public.vets TO service_role;
ALTER TABLE public.vets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read vets" ON public.vets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write vets" ON public.vets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Reference: diseases
CREATE TABLE public.diseases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  species TEXT[] NOT NULL DEFAULT '{}',
  symptoms TEXT[] NOT NULL DEFAULT '{}',
  prevention TEXT,
  treatment_notes TEXT,
  urgency TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.diseases TO anon, authenticated;
GRANT ALL ON public.diseases TO service_role;
ALTER TABLE public.diseases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read diseases" ON public.diseases FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write diseases" ON public.diseases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- User-owned: farms
CREATE TABLE public.farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  county TEXT,
  sub_county TEXT,
  space_m2 NUMERIC,
  budget_kes NUMERIC,
  housing TEXT,
  poultry_type_id UUID REFERENCES public.poultry_types(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farms TO authenticated;
GRANT ALL ON public.farms TO service_role;
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own farms" ON public.farms FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER farms_updated_at BEFORE UPDATE ON public.farms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- User-owned: feasibility_reports
CREATE TABLE public.feasibility_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
  inputs JSONB NOT NULL,
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.feasibility_reports TO authenticated;
GRANT ALL ON public.feasibility_reports TO service_role;
ALTER TABLE public.feasibility_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports" ON public.feasibility_reports FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User-owned: disease_predictions
CREATE TABLE public.disease_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  species TEXT,
  symptoms TEXT[] NOT NULL DEFAULT '{}',
  ml_response JSONB,
  top_disease_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.disease_predictions TO authenticated;
GRANT ALL ON public.disease_predictions TO service_role;
ALTER TABLE public.disease_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own predictions" ON public.disease_predictions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
