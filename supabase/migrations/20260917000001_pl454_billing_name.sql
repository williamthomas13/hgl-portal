-- PL-454: optional separate billing contact per family.
-- families.billing_email has existed since 20260713000001 (phase 7a, "the
-- mom's assistant" requirement) as a DELIVERY address only — parent_email
-- remains the sign-in identity and the RLS key. This adds the contact's
-- NAME beside it so the portal and the family profile can show who billing
-- mail goes to. Nullable; a null pair means "everything goes to the parent"
-- (byte-identical to today). No auth user is ever minted for it.
-- Idempotent.
alter table public.families
  add column if not exists billing_name text;

comment on column public.families.billing_name is
  'PL-454: optional billing contact name (a spouse / office / accountant). Delivery-only — never a login.';
comment on column public.families.billing_email is
  'Optional billing contact address. Billing-flagged templates (registry BILLING_TEMPLATE_KEYS) route here when set; never a login (parent_email is the identity).';
