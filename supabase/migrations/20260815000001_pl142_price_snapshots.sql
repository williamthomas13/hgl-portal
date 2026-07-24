-- PL-142: receipts must post the price the family ACTUALLY PAID, not the
-- price the class carries when the QuickBooks queue happens to drain. A
-- price edit after payment used to post a wrong amount (silently short, or
-- a phantom "promo discount" when the receipt no longer balanced) and it
-- corrupted refund splits, which divide by component price.
--
-- Prices are now snapshotted at CART BUILD (the instant the family sees the
-- number) and promoted to the paid columns by the webhook:
--   class_price_snapshot / pending_addon_price  — written by /api/checkout
--   class_price_paid / addon_price_paid         — stamped when payment lands
-- qbo-sync reads the *_paid columns and falls back to the live price only
-- for rows that predate this migration. Idempotent.

alter table public.enrollments
  add column if not exists class_price_snapshot numeric,
  add column if not exists pending_addon_price numeric,
  add column if not exists class_price_paid numeric,
  add column if not exists addon_price_paid numeric;

comment on column public.enrollments.class_price_snapshot is
  'PL-142: class price at cart build; the pending half of class_price_paid.';
comment on column public.enrollments.pending_addon_price is
  'PL-142: in-checkout add-on price at cart build; promoted to addon_price_paid at payment.';
comment on column public.enrollments.class_price_paid is
  'PL-142: class component actually paid — the authority for QBO receipts and refund splits.';
comment on column public.enrollments.addon_price_paid is
  'PL-142: in-checkout add-on component actually paid.';

-- Backfill so existing PAID rows stop depending on the live class price.
-- Best available truth for historic rows: the per-student cart total the
-- PL-125 work already persisted, else the class price as it stands today.
update public.enrollments e
   set class_price_paid = coalesce(
         e.class_price_paid,
         e.pending_checkout_total - coalesce(
           (select a.price_paid from public.enrollment_addons a
             where a.enrollment_id = e.id
               and a.stripe_session_id is not distinct from e.stripe_session_id
             limit 1), 0),
         (select c.price from public.classes c where c.id = e.class_id))
 where e.payment_status in ('Paid', 'Completed', 'Refunded')
   and e.class_price_paid is null;
