const url = process.env.API_HEALTH_URL || "http://127.0.0.1:8788/api/health";
const maxAttempts = 60;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.exit(0);
    }
  } catch {
    // API not ready yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`Timed out waiting for ${url}`);
process.exit(1);
