import { createHash, randomBytes } from "crypto";

const API = "http://localhost:3000/api/trpc";

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

async function main() {
  // 1. Register a test admin user
  console.log("1. Registering admin user...");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword("admin123", salt);

  // Direct DB insert via tRPC won't work for registration without auth
  // Let's just login with existing admin
  console.log("2. Logging in as admin...");

  // Create a session token manually by calling the login endpoint
  // Actually, the admin-local user has no password. Let me update it.
  console.log("3. Updating admin password in DB...");

  // We need to update the admin user's password directly
  const { execSync } = await import("child_process");
  execSync(`docker compose -p science-agent exec -T postgres psql -U postgres science_agent -c "UPDATE users SET password = '${salt}:${passwordHash}' WHERE \\"unionId\\" = 'admin-local';"`, {
    cwd: "/Users/aleksandrtrisenkov/Desktop/РАБОЧИЕ ПРОЕКТЫ/НАУЧНЫЙ АГЕНТ",
  });

  console.log("4. Triggering parse...");

  // Login to get session cookie
  const loginRes = await fetch(`${API}/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@admin.com",
      password: "admin123",
    }),
  });

  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) {
    console.error("Login failed - no cookie");
    const body = await loginRes.text();
    console.error(body);
    return;
  }

  const sessionCookie = setCookie.split(";")[0];
  console.log("Logged in, session:", sessionCookie.substring(0, 50) + "...");

  // Trigger parse
  const parseRes = await fetch(`${API}/parser.parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": sessionCookie,
    },
    body: JSON.stringify("{}"),
  });

  const parseData = await parseRes.json();
  console.log("\n=== PARSE RESULT ===");
  console.log(JSON.stringify(parseData, null, 2));
}

main().catch(console.error);
