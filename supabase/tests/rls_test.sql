-- RLS behaviour tests. Every check raises an exception on failure.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Users: admin, alice (owner), bob (editor), carol (viewer), mallory (stranger)
alter table auth.users disable trigger enforce_signup_allowlist;
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','admin@gmail.com'),
 ('00000000-0000-0000-0000-0000000000a1','alice@christuniversity.in'),
 ('00000000-0000-0000-0000-0000000000b0','bob@christuniversity.in'),
 ('00000000-0000-0000-0000-0000000000c0','carol@christuniversity.in'),
 ('00000000-0000-0000-0000-0000000000d0','mallory@christuniversity.in');
insert into public.profiles (id, full_name, email, role) values
 ('00000000-0000-0000-0000-00000000000a','Admin','admin@gmail.com','admin'),
 ('00000000-0000-0000-0000-0000000000a1','Alice','alice@christuniversity.in','faculty'),
 ('00000000-0000-0000-0000-0000000000b0','Bob','bob@christuniversity.in','faculty'),
 ('00000000-0000-0000-0000-0000000000c0','Carol','carol@christuniversity.in','faculty'),
 ('00000000-0000-0000-0000-0000000000d0','Mallory','mallory@christuniversity.in','faculty');
insert into public.reports (id, owner_id, title, status) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','Alice draft','draft'),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000a1','Alice submitted','completed');
insert into public.collaborators (report_id, user_id, role, status) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b0','Editor','accepted'),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000c0','Viewer','accepted');
insert into storage.objects (bucket_id, name, owner_id) values
 ('reports','11111111-1111-1111-1111-111111111111/attendanceFiles/list.pdf','00000000-0000-0000-0000-0000000000a1'),
 ('reports','00000000-0000-0000-0000-0000000000a1/private/unrelated.pdf','00000000-0000-0000-0000-0000000000a1'),
 ('signatures','00000000-0000-0000-0000-0000000000a1/signature/sig.png','00000000-0000-0000-0000-0000000000a1'),
 ('signatures','00000000-0000-0000-0000-0000000000a1-0.123.png','00000000-0000-0000-0000-0000000000a1');

alter table auth.users enable trigger enforce_signup_allowlist;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
set client_min_messages = notice;

-- ---- mallory (stranger)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d0');
select pg_temp.check((select count(*) from public.reports) = 0, 'stranger sees no reports');
select pg_temp.check((select count(*) from storage.objects) = 0, 'stranger cannot read any stored file');
update public.reports set title = 'pwned' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) from public.collaborators) = 0, 'stranger sees no collaborators');
do $$ begin
  insert into public.notifications (user_id, title, link) values ('00000000-0000-0000-0000-0000000000a1', 'phish', '/home');
  raise exception 'FAILED: stranger could notify another user';
exception when insufficient_privilege then raise notice 'ok - stranger cannot notify other users';
end $$;
do $$ begin
  insert into public.reports (owner_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'forged');
  raise exception 'FAILED: could create report owned by someone else';
exception when insufficient_privilege then raise notice 'ok - cannot create reports for other people';
end $$;
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d0';
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000d0') = 'faculty', 'cannot promote self to admin');
do $$ begin
  insert into storage.objects (bucket_id, name, owner_id) values ('reports','11111111-1111-1111-1111-111111111111/x/evil.png','00000000-0000-0000-0000-0000000000d0');
  raise exception 'FAILED: stranger uploaded into someone else''s report folder';
exception when insufficient_privilege then raise notice 'ok - cannot upload into other report folders';
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('signatures','00000000-0000-0000-0000-0000000000a1/signature/fake.png');
  raise exception 'FAILED: uploaded a signature for another user';
exception when insufficient_privilege then raise notice 'ok - cannot upload signatures for other users';
end $$;
reset role;
select pg_temp.check((select title from public.reports where id = '11111111-1111-1111-1111-111111111111') = 'Alice draft', 'stranger update had no effect');

-- ---- carol (viewer)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
select pg_temp.check((select count(*) from public.reports) = 1, 'viewer sees the shared report only');
select pg_temp.check((select count(*) from storage.objects) = 3, 'viewer can read files and the owner''s signature for the shared report');
select pg_temp.check(not exists (select 1 from storage.objects where name like '%unrelated.pdf'), 'collaborators cannot read the owner''s other personal files');
update public.reports set title = 'viewer edit' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select pg_temp.check((select title from public.reports where id = '11111111-1111-1111-1111-111111111111') = 'Alice draft', 'viewer cannot edit');

-- ---- bob (editor)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
update public.reports set title = 'bob edit', owner_id = '00000000-0000-0000-0000-0000000000b0' where id = '11111111-1111-1111-1111-111111111111';
update public.collaborators set role = 'Editor' where user_id = '00000000-0000-0000-0000-0000000000c0';
reset role;
select pg_temp.check((select title from public.reports where id = '11111111-1111-1111-1111-111111111111') = 'bob edit', 'editor can edit a draft');
select pg_temp.check((select owner_id from public.reports where id = '11111111-1111-1111-1111-111111111111') = '00000000-0000-0000-0000-0000000000a1', 'editor cannot steal ownership');
select pg_temp.check((select role from public.collaborators where user_id = '00000000-0000-0000-0000-0000000000c0') = 'Viewer', 'editor cannot change other collaborators');

-- ---- alice (owner)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.reports set title = 'edited after submit' where id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  update public.reports set status = 'approved' where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'FAILED: owner self-approved';
exception when insufficient_privilege or check_violation then raise notice 'ok - owner cannot approve own report';
end $$;
update public.reports set admin_feedback = 'fake feedback' where id = '11111111-1111-1111-1111-111111111111';
insert into public.collaborators (report_id, user_id) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d0');
update public.collaborators set status = 'accepted' where user_id = '00000000-0000-0000-0000-0000000000d0';
select pg_temp.check((select count(*) from public.activity_logs) = 0, 'faculty cannot read the audit log');
reset role;
select pg_temp.check((select title from public.reports where id = '22222222-2222-2222-2222-222222222222') = 'Alice submitted', 'submitted reports are locked');
select pg_temp.check((select admin_feedback from public.reports where id = '11111111-1111-1111-1111-111111111111') is null, 'only admins write feedback');
select pg_temp.check((select status from public.collaborators where user_id = '00000000-0000-0000-0000-0000000000d0') = 'pending', 'owner cannot accept an invite on the invitee''s behalf');

-- ---- mallory accepts the invitation
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d0');
update public.collaborators set status = 'accepted', role = 'Editor' where user_id = '00000000-0000-0000-0000-0000000000d0';
reset role;
select pg_temp.check((select status || '/' || role from public.collaborators where user_id = '00000000-0000-0000-0000-0000000000d0') = 'accepted/Editor', 'invitee can accept (role stays as granted)');

-- ---- admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.reports) = 2, 'admin sees all reports');
update public.reports set status = 'draft', admin_feedback = 'Please fix dates' where id = '22222222-2222-2222-2222-222222222222';
insert into public.notifications (user_id, title, link) values ('00000000-0000-0000-0000-0000000000a1', 'Revision', '/home/new?id=22222222-2222-2222-2222-222222222222');
do $$ begin
  insert into public.notifications (user_id, title, link) values ('00000000-0000-0000-0000-0000000000a1', 'x', 'https://evil.example');
  raise exception 'FAILED: external notification link accepted';
exception when check_violation then raise notice 'ok - notification links must be internal';
end $$;
reset role;
select pg_temp.check((select admin_feedback from public.reports where id = '22222222-2222-2222-2222-222222222222') = 'Please fix dates', 'admin can return a report with feedback');

-- ---- sign-up allow-list
do $$ begin
  insert into auth.users values (gen_random_uuid(), 'someone@gmail.com');
  raise exception 'FAILED: non-university sign-up allowed';
exception when raise_exception then raise notice 'ok - non-university sign-ups are blocked';
end $$;
insert into auth.users values (gen_random_uuid(), 'new.student@btech.christuniversity.in');
select pg_temp.check(true, 'university sub-domain sign-up allowed');

select pg_temp.check((select bool_and(not public) from storage.buckets where id in ('reports','signatures')), 'buckets are private');

-- ---- report templates
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  insert into public.report_templates (name, definition, created_by) values ('Mine', '{"sections":[]}', '00000000-0000-0000-0000-0000000000a1');
  raise exception 'FAILED: faculty created a template';
exception when insufficient_privilege then raise notice 'ok - faculty cannot create templates';
end $$;
do $$ begin
  perform public.activate_report_template(null);
  raise exception 'FAILED: faculty changed the active template';
exception when insufficient_privilege then raise notice 'ok - faculty cannot activate templates';
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.report_templates (id, name, definition, created_by) values
  ('33333333-3333-3333-3333-333333333333', 'v1', '{"sections":[]}', '00000000-0000-0000-0000-00000000000a'),
  ('44444444-4444-4444-4444-444444444444', 'v2', '{"sections":[]}', '00000000-0000-0000-0000-00000000000a');
select public.activate_report_template('33333333-3333-3333-3333-333333333333');
select public.activate_report_template('44444444-4444-4444-4444-444444444444');
select pg_temp.check((select string_agg(name, ',') from public.report_templates where is_active) = 'v2', 'exactly one active template');
update public.report_templates set definition = '{"sections":[1]}' where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.check((select definition from public.report_templates where id = '44444444-4444-4444-4444-444444444444') = '{"sections":[]}', 'template versions are immutable');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) from public.report_templates) = 2, 'faculty can read templates');
insert into public.reports (owner_id, title, template_id) values ('00000000-0000-0000-0000-0000000000a1', 'templated', '44444444-4444-4444-4444-444444444444');
update public.reports set template_id = '33333333-3333-3333-3333-333333333333' where title = 'templated';
reset role;
select pg_temp.check((select template_id from public.reports where title = 'templated') = '44444444-4444-4444-4444-444444444444', 'report template cannot be swapped by faculty');

-- ---- automatic notifications + email queue
reset role;
delete from public.notifications;
update public.reports set status = 'draft', admin_feedback = null where id = '11111111-1111-1111-1111-111111111111';
delete from public.notifications;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.reports set status = 'completed' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000000a' and title = 'Report submitted for review') = 1, 'admins are notified when a report is submitted');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.reports set status = 'draft', admin_feedback = 'Add photos' where id = '11111111-1111-1111-1111-111111111111';
insert into public.reports (owner_id, title) values ('00000000-0000-0000-0000-0000000000c0', 'Assigned to Carol');
reset role;
select pg_temp.check((select message from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title = 'Report revision required') like '%Add photos%', 'owner is notified of a revision request with the comment');
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c0' and title = 'New report assigned') = 1, 'faculty are notified of assigned reports');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.collaborators (report_id, user_id, role) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000b0', 'Viewer');
reset role;
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b0' and title = 'Collaboration invite') = 1, 'invitees are notified');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
update public.collaborators set status = 'accepted' where report_id = '22222222-2222-2222-2222-222222222222' and user_id = '00000000-0000-0000-0000-0000000000b0';
reset role;
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title = 'Invitation accepted') = 1, 'owner is notified when an invite is accepted');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform public.claim_notification_emails(10);
  raise exception 'FAILED: faculty can read the email queue';
exception when insufficient_privilege then raise notice 'ok - only the server can claim queued emails';
end $$;
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select pg_temp.check((select is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'users cannot deactivate or reactivate themselves');

update public.profiles set email_notifications = false where id = '00000000-0000-0000-0000-0000000000c0';
select pg_temp.check((select count(*) from public.claim_notification_emails(100)) >= 5, 'pending emails can be claimed');
select pg_temp.check((select count(*) from public.claim_notification_emails(100)) = 0, 'claimed emails are not claimed twice');
select pg_temp.check((select count(*) from public.notifications where email_status = 'sending') >= 5, 'claimed emails are marked as sending');

select set_config('request.jwt.claim.sub', '', false); -- act as the service role
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.reports) = 0, 'a deactivated admin loses admin rights');
reset role;

-- ---- review fixes: notification queue is server-only
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
insert into public.notifications (user_id, title, link) values ('00000000-0000-0000-0000-0000000000b0', 'spam me', '/home');
update public.notifications set email_status = 'pending', title = 'changed', is_read = true where user_id = '00000000-0000-0000-0000-0000000000b0';
reset role;
select pg_temp.check((select email_status from public.notifications where title = 'spam me' and user_id = '00000000-0000-0000-0000-0000000000b0') = 'skipped', 'users cannot queue emails with self-inserted notifications');
select pg_temp.check(not exists (select 1 from public.notifications where title = 'changed'), 'users cannot rewrite notification content');
select pg_temp.check((select bool_and(is_read) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b0'), 'users can still mark notifications read');
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b0' and email_status = 'pending') = 0, 'users cannot reset delivery state');

-- ---- review fixes: stale claims are retried by claim time
select set_config('request.jwt.claim.sub', '', false);
insert into public.notifications (id, user_id, title, created_at, email_status, email_claimed_at)
values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-0000000000b0', 'old but just claimed', now() - interval '1 hour', 'sending', now());
select pg_temp.check(not exists (select 1 from public.claim_notification_emails(100) where id = '55555555-5555-5555-5555-555555555555'), 'a freshly claimed old notification is not claimed twice');
update public.notifications set email_claimed_at = now() - interval '20 minutes' where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.check(exists (select 1 from public.claim_notification_emails(100) where id = '55555555-5555-5555-5555-555555555555'), 'an abandoned claim is retried after 15 minutes');

-- ---- 2026-11-08 fixes: locked reports keep their files
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.reports (id, owner_id, title, status) values
 ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-0000000000a1','Lock test draft','draft'),
 ('77777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-0000000000a1','Lock test submitted','completed');
insert into public.collaborators (report_id, user_id, role, status) values
 ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-0000000000b0','Editor','accepted');
insert into storage.objects (bucket_id, name, owner_id) values
 ('reports','66666666-6666-6666-6666-666666666666/photos/alice.jpg','00000000-0000-0000-0000-0000000000a1'),
 ('reports','66666666-6666-6666-6666-666666666666/photos/bob1.jpg','00000000-0000-0000-0000-0000000000b0'),
 ('reports','66666666-6666-6666-6666-666666666666/photos/bob2.jpg','00000000-0000-0000-0000-0000000000b0'),
 ('reports','77777777-7777-7777-7777-777777777777/photos/locked.jpg','00000000-0000-0000-0000-0000000000a1'),
 ('reports','00000000-0000-0000-0000-0000000000a1/tmp/own.jpg','00000000-0000-0000-0000-0000000000a1');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
delete from storage.objects where name like '77777777-%/photos/locked.jpg';
delete from storage.objects where name like '66666666-%/photos/alice.jpg';
delete from storage.objects where name like '66666666-%/photos/bob1.jpg';
delete from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/tmp/own.jpg';
reset role;
select pg_temp.check(exists (select 1 from storage.objects where name like '77777777-%/photos/locked.jpg'), 'files of a submitted report cannot be deleted');
select pg_temp.check(not exists (select 1 from storage.objects where name like '66666666-%/photos/alice.jpg'), 'the owner can delete own files from a draft');
select pg_temp.check(exists (select 1 from storage.objects where name like '66666666-%/photos/bob1.jpg'), 'nobody can delete files someone else uploaded');
select pg_temp.check(not exists (select 1 from storage.objects where name like '%/tmp/own.jpg'), 'users can delete files in their personal folder');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
delete from storage.objects where name like '66666666-%/photos/bob1.jpg';
reset role;
select pg_temp.check(not exists (select 1 from storage.objects where name like '66666666-%/photos/bob1.jpg'), 'an editor can delete own files from a draft');

select set_config('request.jwt.claim.sub', '', false);
delete from public.collaborators where report_id = '66666666-6666-6666-6666-666666666666' and user_id = '00000000-0000-0000-0000-0000000000b0';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
delete from storage.objects where name like '66666666-%/photos/bob2.jpg';
reset role;
select pg_temp.check(exists (select 1 from storage.objects where name like '66666666-%/photos/bob2.jpg'), 'a removed collaborator cannot delete files from the report');

-- ---- 2026-11-08 fixes: pending invitees only see the invitation
select set_config('request.jwt.claim.sub', '', false);
insert into public.collaborators (report_id, user_id, role, status) values
 ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-0000000000c0','Viewer','pending');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
select pg_temp.check(not exists (select 1 from public.reports where id = '66666666-6666-6666-6666-666666666666'), 'a pending invitee cannot read the report');
select pg_temp.check(not exists (select 1 from storage.objects where name like '66666666-%'), 'a pending invitee cannot read the report''s files');
select pg_temp.check((select report_title || ' / ' || owner_name || ' / ' || role from public.my_pending_invitations()
                      where report_id = '66666666-6666-6666-6666-666666666666') = 'Lock test draft / Alice / Viewer', 'a pending invitee sees title, inviter and role');
update public.collaborators set status = 'accepted' where report_id = '66666666-6666-6666-6666-666666666666' and user_id = '00000000-0000-0000-0000-0000000000c0';
select pg_temp.check(exists (select 1 from public.reports where id = '66666666-6666-6666-6666-666666666666'), 'after accepting, the invitee can read the report');
select pg_temp.check(not exists (select 1 from public.my_pending_invitations() where report_id = '66666666-6666-6666-6666-666666666666'), 'accepted invitations leave the pending list');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d0');
select pg_temp.check(not exists (select 1 from public.my_pending_invitations() where report_id = '66666666-6666-6666-6666-666666666666'), 'nobody sees other people''s invitations');
reset role;

-- ---- 2026-11-08 fixes: activity log authorship
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d0');
insert into public.activity_logs (user_id, user_name, action_type, description, created_at)
values ('00000000-0000-0000-0000-0000000000d0', 'Admin', 'REPORT_APPROVED', 'approved "Everything"', '2000-01-01');
reset role;
select pg_temp.check((select user_name from public.activity_logs where description = 'approved "Everything"') = 'Mallory', 'activity entries show the real author');
select pg_temp.check((select created_at from public.activity_logs where description = 'approved "Everything"') > now() - interval '1 minute', 'activity entries cannot be backdated');

-- ---- 2026-11-26: event calendar
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-00000000000a';

-- Faculty can see the calendar but not add to it.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
do $$ begin
    perform public.schedule_event('Sneaky', '2026-12-10', '10:00', '12:00', '00000000-0000-0000-0000-0000000000b0', null, '{}', '2026-11-26');
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'faculty could schedule an event'; end if; end $$;
do $$ begin
    insert into public.events (title, event_date, organizer_id) values ('Direct', '2026-12-10', '00000000-0000-0000-0000-0000000000b0');
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'faculty could insert an event'; end if; end $$;
do $$ begin
    perform public.queue_event_reminders('2026-12-10');
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'faculty could trigger reminders'; end if; end $$;
reset role;
select pg_temp.check(true, 'faculty cannot schedule events, insert them directly, or trigger reminders');

-- An admin schedules an event for Alice: event + draft report owned by Alice + email to Alice.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('AI Workshop', '2026-12-10', '10:00', '12:00', '00000000-0000-0000-0000-0000000000a1',
    null, '{"activityTitle":"AI Workshop","date":"2026-12-10"}', '2026-11-26');
do $$ begin
    perform public.schedule_event('Backwards', '2026-12-10', '12:00', '10:00', '00000000-0000-0000-0000-0000000000a1', null, '{}', '2026-11-26');
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'end before start was accepted'; end if; end $$;
reset role;
select pg_temp.check((select r.owner_id::text || '/' || r.status::text || '/' || (r.data->>'date')
                      from public.events e join public.reports r on r.id = e.report_id where e.title = 'AI Workshop')
                     = '00000000-0000-0000-0000-0000000000a1/draft/2026-12-10', 'scheduling creates a prefilled draft report owned by the organizer');
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                      and title = 'Event scheduled: "AI Workshop"' and email_status = 'pending') = 1, 'the organizer is emailed when an event is scheduled');
select pg_temp.check((select last_reminder_on from public.events where title = 'AI Workshop') = '2026-11-26', 'no second email on the day it was scheduled');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
select pg_temp.check((select count(*) from public.events where title = 'AI Workshop') = 1, 'everyone signed in can see the calendar');
reset role;

-- Admins may upload the NFA into the draft report; others may not.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.storage_can_write_report_file((select report_id::text from public.events where title = 'AI Workshop') || '/approvalFiles/nfa.pdf'),
    'an admin can upload the NFA into the draft report');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
select pg_temp.check(not public.storage_can_write_report_file((select report_id::text from public.events where title = 'AI Workshop') || '/approvalFiles/nfa.pdf'),
    'other faculty cannot upload into it');
reset role;

-- Reminders: daily from 7 days before, after the event too, until the report is submitted.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(public.queue_event_reminders('2026-12-02') = 0, 'no reminder 8 days before the event');
select pg_temp.check(public.queue_event_reminders('2026-12-03') = 1, 'first reminder 7 days before the event');
select pg_temp.check(public.queue_event_reminders('2026-12-03') = 0, 'at most one reminder per day');
select pg_temp.check(public.queue_event_reminders('2026-12-04') = 1, 'a reminder every day');
select pg_temp.check(public.queue_event_reminders('2026-12-12') = 1, 'reminders continue after the event');
select pg_temp.check((select title from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' order by created_at desc, title limit 1)
                     like 'Report pending: "AI Workshop"', 'after the event the reminder says the report is pending');
select pg_temp.check(exists (select 1 from public.notifications where message like '%(2 days ago)%'), 'the reminder says how long ago the event was');
update public.reports set status = 'completed' where id = (select report_id from public.events where title = 'AI Workshop');
select pg_temp.check(public.queue_event_reminders('2026-12-13') = 0, 'reminders stop once the report is submitted');

-- Cancelling: a draft report goes with the event; a submitted one is kept.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('Guest Talk', '2026-12-20', null, null, '00000000-0000-0000-0000-0000000000c0', null, '{}', '2026-11-26');
reset role;
select set_config('request.jwt.claim.sub', '', false);
create temp table guest_talk as select id, report_id from public.events where title = 'Guest Talk';
create temp table workshop as select id, report_id from public.events where title = 'AI Workshop';
grant select on guest_talk, workshop to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
do $$ begin
    perform public.cancel_event((select id from guest_talk));
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'faculty could cancel an event'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.cancel_event((select id from guest_talk));
select public.cancel_event((select id from workshop));
reset role;
select pg_temp.check(not exists (select 1 from public.events where title in ('Guest Talk', 'AI Workshop')), 'admins can cancel events');
select pg_temp.check(not exists (select 1 from public.reports where id = (select report_id from guest_talk)), 'cancelling removes a draft report');
select pg_temp.check(exists (select 1 from public.reports where id = (select report_id from workshop)), 'cancelling keeps a submitted report');
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c0' and title = 'Event cancelled: "Guest Talk"') = 1,
    'the organizer is told when an event is cancelled');

-- ---- 2026-11-27: organizers typed as an email address
-- A typed email of a DeptDocs user works like picking that user.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('Typed member', '2026-12-15', '09:00', null, null, null, '{}', '2026-11-27', '  BOB@christuniversity.in ');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select e.organizer_id::text || '/' || (e.report_id is not null)::text from public.events e where e.title = 'Typed member')
                     = '00000000-0000-0000-0000-0000000000b0/true', 'a typed email of a member assigns that member and creates their report');

-- Someone without an account.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('Industry Talk', '2026-12-20', '11:00', '12:00', null, null,
    '{"activityTitle":"Industry Talk","date":"2026-12-20"}', '2026-11-27', 'Guest.Speaker@Example.com', 'Dr. Guest');
do $$ begin
    perform public.schedule_event('Bad email', '2026-12-20', '11:00', null, null, null, '{}', '2026-11-27', 'not-an-email');
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'an invalid email was accepted'; end if; end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select organizer_id is null and organizer_email = 'guest.speaker@example.com' and report_id is null
                             and report_data->>'date' = '2026-12-20' from public.events where title = 'Industry Talk'),
    'an event can name an organizer without an account (email kept, report data held)');
select pg_temp.check((select count(*) from public.outbound_emails where to_email = 'guest.speaker@example.com'
                      and title = 'Event scheduled: "Industry Talk"' and link = '/signup' and email_status = 'pending') = 1,
    'the email address is emailed with sign-up instructions');
select pg_temp.check(exists (select 1 from public.signup_allowlist where entry = 'guest.speaker@example.com'),
    'their email is allowed to sign up');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0');
do $$ begin
    perform count(*) from public.outbound_emails;
    raise exception 'SHOULD_FAIL';
exception when others then if sqlerrm = 'SHOULD_FAIL' then raise exception 'users could read the outbound email queue'; end if; end $$;
reset role;
select pg_temp.check(true, 'users cannot read the outbound email queue');

-- Admins can store the NFA in the event's folder before there is a report.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.storage_can_write_report_file((select id::text from public.events where title = 'Industry Talk') || '/approvalFiles/nfa.pdf'),
    'an admin can upload the NFA of an event without a report');
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into storage.objects (bucket_id, name, owner_id)
select 'reports', id::text || '/approvalFiles/nfa.pdf', '00000000-0000-0000-0000-00000000000a' from public.events where title = 'Industry Talk';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
select pg_temp.check(not exists (select 1 from storage.objects where name like '%/approvalFiles/nfa.pdf'
                                 and name like (select id::text from public.events where title = 'Industry Talk') || '%'),
    'other people cannot read the NFA of someone else''s event');
reset role;

-- Reminders reach the email address until they sign up.
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(public.queue_event_reminders('2026-12-13') >= 1, 'organizers without an account get reminders');
select pg_temp.check((select count(*) from public.outbound_emails where to_email = 'guest.speaker@example.com'
                      and title = 'Reminder: "Industry Talk" is in 7 days' and message like '%Sign up to DeptDocs with guest.speaker@example.com%') = 1,
    'the reminder tells them to sign up with that email');
select pg_temp.check(public.queue_event_reminders('2026-12-13') = 0, 'still at most one reminder per day');

-- Signing up with that email moves the event and a prefilled report into the new account.
insert into auth.users values ('00000000-0000-0000-0000-0000000000e0', 'guest.speaker@example.com');
insert into public.profiles (id, full_name, email, role) values ('00000000-0000-0000-0000-0000000000e0', 'Guest', 'Guest.Speaker@example.com', 'faculty');
select pg_temp.check((select e.organizer_id = '00000000-0000-0000-0000-0000000000e0' and r.owner_id = e.organizer_id and r.status::text = 'draft'
                             and r.data->>'date' = '2026-12-20' and e.report_data is null
                      from public.events e join public.reports r on r.id = e.report_id where e.title = 'Industry Talk'),
    'signing up with the email claims the event and its prefilled report');
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e0'
                      and title = 'Event assigned to you: "Industry Talk"') = 1, 'the new user is told about the event');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check(exists (select 1 from storage.objects where name like (select id::text from public.events where title = 'Industry Talk') || '/approvalFiles/nfa.pdf'),
    'the organizer can read the NFA once they have signed up');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check(public.queue_event_reminders('2026-12-14') >= 1, 'reminders continue after signing up');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e0'
                             and title = 'Reminder: "Industry Talk" is in 6 days'),
    'after signing up, reminders arrive in DeptDocs and by email as usual');

-- Cancelling an event of someone without an account emails them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('Outside Workshop', '2026-12-22', null, null, null, null, '{}', '2026-11-27', 'visitor@example.org');
select public.cancel_event((select id from public.events where title = 'Outside Workshop'));
reset role;
select pg_temp.check((select count(*) from public.outbound_emails where to_email = 'visitor@example.org' and title = 'Event cancelled: "Outside Workshop"') = 1,
    'cancelling tells an organizer without an account');

-- With an empty allow-list (open sign-up), scheduling must not close sign-up for everyone else.
select set_config('request.jwt.claim.sub', '', false);
create temp table saved_allowlist as select * from public.signup_allowlist;
delete from public.signup_allowlist;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select * from public.schedule_event('Open signup', '2026-12-23', null, null, null, null, '{}', '2026-11-27', 'someone@example.net');
reset role;
select pg_temp.check(not exists (select 1 from public.signup_allowlist), 'an open sign-up stays open');
insert into public.signup_allowlist select * from saved_allowlist;
