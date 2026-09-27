# Security

## Reporting a problem

Please report vulnerabilities privately rather than in a public issue: through GitHub's **Report a vulnerability** button on this repository's Security tab when it's available, or otherwise by contacting the repository owner through their GitHub profile.

## How Podblock protects itself

- **Who can use it.** Anyone can sign up, but nothing costs the owner anything until the admin approves the account. Every API route checks the session itself; the sign-in proxy only checks that a session cookie exists.
- **Fetching episode audio (SSRF).** Episode URLs come from users, so the server only fetches public internet addresses. The check runs on the addresses actually connected to, inside the connection's DNS lookup, so DNS rebinding can't slip past it. It is repeated on every redirect, and understands IPv4 embedded in IPv6 (mapped, compatible, NAT64) and the IANA special-purpose ranges. ffmpeg only ever talks to a loopback proxy, over plain HTTP.
- **Requests from other sites.** State-changing API requests must be JSON (which forces a CORS preflight that is never granted), and must come from the site's own origin or a configured one.
- **Browser hardening.** A content security policy (no framing, plugins, `<base>` changes, off-site form posts or API calls), plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP and, in production, HSTS.
- **Errors.** Clients get a message written for them and a code; ffmpeg output, file paths and provider responses stay in the server log.
- **Secrets.** API keys live only in the server's environment. The logs redact configured secret values, and the setup checks never print them.
- **The admin account.** Creating the account with `PODBLOCK_ADMIN_EMAIL` takes a one-time setup code (`PODBLOCK_SETUP_CODE`) or an email address GitHub or Google has verified, so nobody can claim it first. At startup an existing account with that email is made admin only if the admin had approved it or a provider verified it.
- **Sign-in.** Better Auth: passwords of at least 10 characters, rate-limited sign-in and sign-up (counts stored in the database, so they hold across serverless instances), and a sign-in redirect limited to paths on the site.

## Known limitations

- **Session cache:** a disabled account can keep access for up to 60 seconds.
- **Inline scripts:** the content security policy allows inline scripts (Next.js's hydration scripts are inline), so it limits but doesn't prevent script injection.
- **Bundled ffmpeg** is a 2018 static build decoding files that users choose. A move to a maintained build is planned (S-7).
- **Rate limiting behind a proxy** relies on `X-Forwarded-For`. Without it, all visitors share one limit.
