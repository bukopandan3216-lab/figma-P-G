import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const roles = new Set(['customer', 'beauty_staff', 'beauty_admin', 'super_admin']);

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return response(500, { error: 'User management is not configured.' });

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response(401, { error: 'Authentication is required.' });

  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return response(401, { error: 'Authentication is invalid or expired.' });

  const actorId = authData.user.id;
  const { data: actor, error: actorError } = await adminClient
    .from('profiles')
    .select('role, account_status')
    .eq('id', actorId)
    .maybeSingle();
  if (actorError) {
    console.error('manage-user actor profile lookup failed', {
      code: actorError.code,
      message: actorError.message,
      details: actorError.details,
    });
    if (actorError.message.toLowerCase().includes('account_status')) {
      return response(500, { error: 'The profiles.account_status column is unavailable. Run supabase/customer_status_activity.sql in the Supabase SQL Editor, then redeploy manage-user.' });
    }
    return response(500, { error: `Unable to verify user-management permissions (database error ${actorError.code || 'unknown'}). Check the Edge Function logs and SUPABASE_SERVICE_ROLE_KEY.` });
  }
  if (actor?.account_status === 'Inactive') return response(403, { error: 'This administrator account is inactive.' });

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return response(400, { error: 'Request body must be valid JSON.' });
  }

  if (input.action === 'status') {
    if (actor?.role !== 'super_admin' && actor?.role !== 'beauty_admin') {
      return response(403, { error: 'Beauty Administrator access is required to manage customer status.' });
    }
    const id = typeof input.id === 'string' ? input.id : '';
    const status = input.status;
    if (!id || (status !== 'Active' && status !== 'Inactive')) {
      return response(400, { error: 'A customer ID and valid account status are required.' });
    }
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, role, account_status, first_name, last_name, email')
      .eq('id', id)
      .maybeSingle();
    if (targetError) return response(500, { error: 'Unable to load the customer account.' });
    if (!target || target.role !== 'customer') return response(404, { error: 'Customer account not found.' });
    if (target.account_status === status) return response(200, { user: target });

    const { data: updated, error: updateError } = await adminClient.from('profiles')
      .update({ account_status: status })
      .eq('id', id)
      .select('id, role, account_status, first_name, last_name, email')
      .single();
    if (updateError) return response(400, { error: updateError.message });

    const { error: auditError } = await adminClient.from('user_activity_log').insert({
      actor_id: actorId,
      action: 'customer.status_changed',
      details: { user_id: id, previous_status: target.account_status || 'Active', status },
    });
    if (auditError) {
      const { error: rollbackError } = await adminClient.from('profiles').update({ account_status: target.account_status || 'Active' }).eq('id', id);
      return response(500, { error: rollbackError ? `Status changed but audit logging and rollback failed: ${auditError.message}; ${rollbackError.message}` : `Status change was rolled back because audit logging failed: ${auditError.message}` });
    }
    return response(200, { user: updated });
  }

  if (actor?.role !== 'super_admin') return response(403, { error: 'P&G Super Administrator access is required.' });

  if (input.action === 'invite') {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const firstName = typeof input.first_name === 'string' ? input.first_name.trim() : '';
    const lastName = typeof input.last_name === 'string' ? input.last_name.trim() : '';
    const role = input.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName || typeof role !== 'string' || !roles.has(role)) {
      return response(400, { error: 'Valid email, first name, last name, and role are required.' });
    }

    const { data: invitation, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { first_name: firstName, last_name: lastName },
    });
    if (inviteError || !invitation.user) return response(400, { error: inviteError?.message || 'Unable to invite this user.' });

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .update({ first_name: firstName, last_name: lastName, email, role })
      .eq('id', invitation.user.id)
      .select('id, first_name, last_name, email, role, created_at')
      .single();
    if (profileError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invitation.user.id);
      return response(500, { error: cleanupError ? `Profile creation failed and the invited user could not be removed: ${profileError.message}; ${cleanupError.message}` : `Profile creation failed; the invitation was removed: ${profileError.message}` });
    }

    const { error: auditError } = await adminClient.from('user_activity_log').insert({
      actor_id: actorId,
      action: 'user.invited',
      details: { user_id: profile.id, role },
    });
    if (auditError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invitation.user.id);
      return response(500, { error: cleanupError ? `User was invited but audit logging and cleanup failed: ${auditError.message}; ${cleanupError.message}` : `Invitation was removed because audit logging failed: ${auditError.message}` });
    }
    return response(201, { user: profile });
  }

  if (input.action === 'role') {
    const id = typeof input.id === 'string' ? input.id : '';
    const role = input.role;
    if (!id || id === actorId || typeof role !== 'string' || !roles.has(role)) {
      return response(400, { error: 'A different user ID and valid role are required.' });
    }
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, role, first_name, last_name, email, created_at')
      .eq('id', id)
      .maybeSingle();
    if (targetError) return response(500, { error: 'Unable to load the target user.' });
    if (!target) return response(404, { error: 'User not found.' });

    if (target.role === 'super_admin' && role !== 'super_admin') {
      const { count, error: countError } = await adminClient.from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');
      if (countError) return response(500, { error: 'Unable to verify Super Administrator accounts.' });
      if ((count || 0) <= 1) return response(400, { error: 'The last Super Administrator cannot be demoted.' });
    }

    const { data: updated, error: updateError } = await adminClient.from('profiles')
      .update({ role })
      .eq('id', id)
      .select('id, first_name, last_name, email, role, created_at')
      .single();
    if (updateError) return response(400, { error: updateError.message });

    const { error: auditError } = await adminClient.from('user_activity_log').insert({
      actor_id: actorId,
      action: 'user.role_changed',
      details: { user_id: id, previous_role: target.role, role },
    });
    if (auditError) {
      const { error: rollbackError } = await adminClient.from('profiles').update({ role: target.role }).eq('id', id);
      return response(500, { error: rollbackError ? `Role changed but audit logging and rollback failed: ${auditError.message}; ${rollbackError.message}` : `Role change was rolled back because audit logging failed: ${auditError.message}` });
    }
    return response(200, { user: updated });
  }

  return response(400, { error: 'Unknown user-management action.' });
});