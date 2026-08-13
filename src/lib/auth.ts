// Supabase-backed auth, with a synchronous local cache so existing components
// that call getCurrentUser() / getProfile() during render keep working.
// FarmerProfile is still kept in localStorage as a UI cache; the source of
// truth for a signed-in user's farm data is the `farms` table on the backend.

import { supabase } from "@/integrations/supabase/client";

const USER_CACHE_KEY = "poultryfit.user";
const PROFILE_KEY = "poultryfit.profile";

export interface AuthUser {
  email: string;
  name: string;
  id: string;
}

export type HousingType = "backyard-open" | "deep-litter" | "cage" | "free-range";
export type Experience = "first-time" | "some" | "experienced";
export type BirdGoal = "eggs" | "meat" | "dual";
export type PoultryType = "chicken" | "duck" | "turkey" | "goose" | "quail" | "guinea-fowl";
export type StartingStage = "chick" | "grower" | "layer";

export interface FarmerProfile {
  county: string;
  ward?: string;
  spaceM2: number;
  lengthM?: number;
  widthM?: number;
  budgetKes: number;
  housing: HousingType;
  goal: BirdGoal;
  experience: Experience;
  startingStage: StartingStage;
  poultryTypes: PoultryType[];
  /** Relative priority weight per selected species, e.g. { chicken: 2, duck: 1 }.
   *  Missing/empty means split evenly, same as a single-species profile. */
  speciesRatio?: Partial<Record<PoultryType, number>>;
  createdAt: string;
}

function read<T>(k: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_CACHE_KEY);
  window.dispatchEvent(new Event("poultryfit-auth"));
}

export function getCurrentUser(): AuthUser | null {
  return read<AuthUser | null>(USER_CACHE_KEY, null);
}
export function getProfile(): FarmerProfile | null {
  return read<FarmerProfile | null>(PROFILE_KEY, null);
}
/**
 * Saves the profile to local cache immediately (so the UI feels instant),
 * then mirrors it to Supabase. Returns whether the Supabase write actually
 * succeeded, callers should check this and warn the user if it's false,
 * rather than assuming a save always works.
 */
export async function saveProfile(p: FarmerProfile): Promise<{ synced: boolean; error?: string }> {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  window.dispatchEvent(new Event("poultryfit-auth"));
  const u = getCurrentUser();
  if (!u) return { synced: false, error: "Not signed in" };

  const { error } = await supabase.from("farms").upsert(
    {
      user_id: u.id,
      name: "My farm",
      county: p.county,
      sub_county: p.ward,
      space_m2: p.spaceM2,
      length_m: p.lengthM ?? null,
      width_m: p.widthM ?? null,
      budget_kes: p.budgetKes,
      housing: p.housing,
      goal: p.goal,
      experience: p.experience,
      starting_stage: p.startingStage,
      poultry_type_slugs: p.poultryTypes?.length ? p.poultryTypes : ["chicken"],
      species_ratio: p.speciesRatio && Object.keys(p.speciesRatio).length ? p.speciesRatio : null,
    } as never,
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("Failed to save farm profile to Supabase:", error.message);
    return { synced: false, error: error.message };
  }
  return { synced: true };
}

function toAuthUser(
  u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null,
): AuthUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = (meta.full_name as string) || (meta.name as string) || (u.email ?? "").split("@")[0];
  return { id: u.id, email: u.email ?? "", name };
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  email = email.trim().toLowerCase();
  if (!name.trim() || !email || password.length < 8) {
    throw new Error("Enter your name, a valid email and a password of 8+ characters.");
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name.trim() },
      emailRedirectTo: `${window.location.origin}/dashboard`,
    },
  });
  if (error) throw new Error(error.message);
  // Supabase deliberately doesn't return an error for a duplicate email,
  // it returns a user object with an empty identities array instead, to
  // avoid letting attackers probe which emails are registered. We can
  // still detect this ourselves and give a real, actionable message.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error("An account with this email already exists. Try signing in instead.");
  }
  const user = toAuthUser(data.user);
  if (!user)
    throw new Error("Sign up succeeded but no user returned. Check your email to confirm.");
  writeCache(user);
  return user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  email = email.trim().toLowerCase();
  if (!email) throw new Error("Enter your email.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
}

export async function updatePassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Password must be 8+ characters.");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  email = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase deliberately returns the same generic error whether the
    // email doesn't exist or the password is wrong, so we can't tell
    // those apart, but we can still nudge toward the likely fix.
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      throw new Error(
        "Incorrect email or password. If you haven't created an account yet, sign up instead.",
      );
    }
    throw new Error(error.message);
  }
  const user = toAuthUser(data.user);
  if (!user) throw new Error("Sign in failed.");
  writeCache(user);
  return user;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/dashboard" },
  });
  if (error) throw new Error(error.message ?? "Google sign-in failed");
  // Browser will redirect to Google; session hydrates on return via onAuthStateChange.
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  if (typeof window !== "undefined") {
    localStorage.removeItem(PROFILE_KEY);
  }
  writeCache(null);
}

const HOUSING_VALUES: HousingType[] = ["backyard-open", "deep-litter", "cage", "free-range"];
function isHousing(v: unknown): v is HousingType {
  return typeof v === "string" && (HOUSING_VALUES as string[]).includes(v);
}
const GOAL_VALUES: BirdGoal[] = ["eggs", "meat", "dual"];
function isGoal(v: unknown): v is BirdGoal {
  return typeof v === "string" && (GOAL_VALUES as string[]).includes(v);
}
const EXPERIENCE_VALUES: Experience[] = ["first-time", "some", "experienced"];
function isExperience(v: unknown): v is Experience {
  return typeof v === "string" && (EXPERIENCE_VALUES as string[]).includes(v);
}
const STAGE_VALUES: StartingStage[] = ["chick", "grower", "layer"];
function isStage(v: unknown): v is StartingStage {
  return typeof v === "string" && (STAGE_VALUES as string[]).includes(v);
}
const POULTRY_TYPE_VALUES: PoultryType[] = [
  "chicken",
  "duck",
  "turkey",
  "goose",
  "quail",
  "guinea-fowl",
];
function toPoultryTypes(v: unknown): PoultryType[] {
  if (!Array.isArray(v)) return ["chicken"];
  const valid = v.filter((x): x is PoultryType => (POULTRY_TYPE_VALUES as string[]).includes(x));
  return valid.length ? valid : ["chicken"];
}
function toSpeciesRatio(v: unknown): Partial<Record<PoultryType, number>> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Partial<Record<PoultryType, number>> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if ((POULTRY_TYPE_VALUES as string[]).includes(k) && typeof val === "number" && val > 0) {
      out[k as PoultryType] = val;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

async function fetchFarmRow(userId: string) {
  return supabase
    .from("farms")
    .select(
      "county, sub_county, space_m2, length_m, width_m, budget_kes, housing, goal, experience, starting_stage, poultry_type_slugs, species_ratio",
    )
    .eq("user_id", userId)
    .maybeSingle() as unknown as Promise<{
    data: {
      county: string | null;
      sub_county: string | null;
      space_m2: number | null;
      length_m: number | null;
      width_m: number | null;
      budget_kes: number | null;
      housing: string | null;
      goal: string | null;
      experience: string | null;
      starting_stage: string | null;
      poultry_type_slugs: string[] | null;
      species_ratio: unknown;
    } | null;
    error: { message: string } | null;
  }>;
}

export async function hydrateProfileFromFarm(userId: string): Promise<FarmerProfile | null> {
  if (typeof window === "undefined") return null;
  if (getProfile()) return getProfile();

  let { data, error } = await fetchFarmRow(userId);

  if (error) {
    // A real error (as opposed to "no row found") is often a transient
    // session-not-fully-settled race right after an OAuth redirect, not
    // genuine evidence the user has no profile. Log it and retry once
    // before concluding that, so a real farmer isn't bounced back to
    // onboarding just because the first query landed a beat too early.

    console.error("hydrateProfileFromFarm: query failed, retrying once:", error.message);
    await new Promise((r) => setTimeout(r, 500));
    ({ data, error } = await fetchFarmRow(userId));
    if (error) {
      console.error("hydrateProfileFromFarm: retry also failed:", error.message);
    }
  }

  if (error || !data) return null;
  const profile: FarmerProfile = {
    county: data.county ?? "",
    ward: data.sub_county ?? undefined,
    spaceM2: data.space_m2 ?? 0,
    lengthM: data.length_m ?? undefined,
    widthM: data.width_m ?? undefined,
    budgetKes: data.budget_kes ?? 0,
    housing: isHousing(data.housing) ? data.housing : "backyard-open",
    goal: isGoal(data.goal) ? data.goal : "eggs",
    experience: isExperience(data.experience) ? data.experience : "first-time",
    startingStage: isStage(data.starting_stage) ? data.starting_stage : "chick",
    poultryTypes: toPoultryTypes(data.poultry_type_slugs),
    speciesRatio: toSpeciesRatio(data.species_ratio),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event("poultryfit-auth"));
  return profile;
}

// Bootstrap: hydrate cache from Supabase session and keep it in sync.
if (typeof window !== "undefined") {
  void supabase.auth.getUser().then(({ data }) => {
    const u = toAuthUser(data.user);
    writeCache(u);
    if (u) void hydrateProfileFromFarm(u.id);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const u = toAuthUser(session?.user ?? null);
    writeCache(u);
    if (u) void hydrateProfileFromFarm(u.id);
  });
}