create or replace function public.signup_allowed(p_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select not exists (select 1 from auth.users)
    or exists (select 1 from public.invitations i where i.accepted_at is null and lower(i.email) = lower(p_email))
    or exists (select 1 from public.client_invitations c where c.accepted_at is null and c.revoked_at is null and lower(c.email) = lower(p_email));
$$;

create or replace function public.enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.signup_allowed(new.email) then
    raise exception 'Inscription sur invitation uniquement';
  end if;
  return new;
end $$;

drop trigger if exists invite_only_signup on auth.users;
create trigger invite_only_signup before insert on auth.users
  for each row execute function public.enforce_invite_only();
