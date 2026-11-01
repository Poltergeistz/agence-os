-- =====================================================================
-- 0122 : réservation « coordonnées d'abord »
-- contact_first : le formulaire passe avant le calendrier et le contact est enregistré dès la saisie.
-- contact_mode  : moyen de contact demandé (email, téléphone ou les deux).
-- terms_url, privacy_url : liens de la mention de consentement affichée sous le formulaire.
-- Les valeurs par défaut conservent le comportement existant.
-- =====================================================================

alter table public.booking_types add column if not exists contact_first boolean not null default false;
alter table public.booking_types add column if not exists contact_mode text not null default 'email';
alter table public.booking_types drop constraint if exists booking_types_contact_mode_check;
alter table public.booking_types add constraint booking_types_contact_mode_check check (contact_mode in ('email', 'phone', 'both'));

alter table public.booking_profiles add column if not exists terms_url text not null default '';
alter table public.booking_profiles add column if not exists privacy_url text not null default '';

create or replace function public.schema_version()
returns int language sql immutable as $$ select 122 $$;
grant execute on function public.schema_version() to authenticated, service_role;
