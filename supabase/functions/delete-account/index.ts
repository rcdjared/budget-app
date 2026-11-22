import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StorageBucket = ReturnType<ReturnType<typeof createClient>["storage"]["from"]>;

function response(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAuthTime(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const authTime = JSON.parse(decoded).auth_time;
    return typeof authTime === "number" ? authTime : null;
  } catch {
    return null;
  }
}

async function listUserFiles(
  storage: StorageBucket,
  folder: string
): Promise<string[]> {
  const files: string[] = [];
  const nestedFolders: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data) {
      const path = `${folder}/${item.name}`;
      if (item.id) files.push(path);
      else nestedFolders.push(path);
    }
    if (data.length < 1000) break;
  }
  for (const nestedFolder of nestedFolders) {
    files.push(...await listUserFiles(storage, nestedFolder));
  }
  return files;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response(401, { error: "Authentication is required." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return response(500, { error: "Account deletion is not configured." });
  }

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !userData.user) return response(401, { error: "Your session is invalid. Sign in again." });

  const authTime = getAuthTime(token);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authTime === null || authTime > nowSeconds || nowSeconds - authTime > 5 * 60) {
    return response(403, { error: "For your security, sign in again before deleting your account." });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userId = userData.user.id;

  try {
    const receiptStorage = admin.storage.from("receipts");
    const receiptFiles = await listUserFiles(receiptStorage, userId);
    for (let index = 0; index < receiptFiles.length; index += 100) {
      const { error } = await receiptStorage.remove(receiptFiles.slice(index, index + 100));
      if (error) throw error;
    }

    const { error: recordsError } = await admin.from("cloud_records").delete().eq("user_id", userId);
    if (recordsError) throw recordsError;

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;
    return response(200, { message: "Account and cloud data deleted." });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return response(500, { error: "Account deletion could not be completed. Please try again or contact support." });
  }
});
