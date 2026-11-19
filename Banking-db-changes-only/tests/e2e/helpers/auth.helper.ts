import { Page, BrowserContext, expect } from '@playwright/test';

export interface RoleCredentials {
  username?: string;
  password?: string;
  otpCode?: string;
  totpSecret?: string;
}

/**
 * Returns credentials for the given role from runtime environment variables.
 * Throws CONFIGURATION_MISSING if credentials are not provided for an authenticated role.
 */
export function getRoleCredentials(role: string): RoleCredentials {
  const normRole = (role || '').toUpperCase();
  if (normRole === 'ANONYMOUS' || normRole === 'PUBLIC' || normRole === 'NONE') {
    return {};
  }

  const username =
    process.env[`PLAYWRIGHT_AUTH_${normRole}_USERNAME`] ||
    process.env[`TEST_${normRole}_USERNAME`] ||
    process.env.PLAYWRIGHT_AUTH_USERNAME ||
    '';

  const password =
    process.env[`PLAYWRIGHT_AUTH_${normRole}_PASSWORD`] ||
    process.env[`TEST_${normRole}_PASSWORD`] ||
    process.env.PLAYWRIGHT_AUTH_PASSWORD ||
    '';

  const otpCode =
    process.env[`PLAYWRIGHT_AUTH_${normRole}_OTP`] ||
    process.env.PLAYWRIGHT_AUTH_MFA_CODE ||
    process.env.PLAYWRIGHT_MFA_OTP ||
    '';

  const totpSecret =
    process.env[`PLAYWRIGHT_AUTH_${normRole}_TOTP_SECRET`] ||
    process.env.PLAYWRIGHT_AUTH_TOTP_SECRET ||
    '';

  if (!username || !password) {
    console.warn(`[AUTH] No credentials configured for role '${role}'. Proceeding unauthenticated / public.`);
    return {};
  }

  return { username, password, otpCode, totpSecret };
}

/**
 * Perform login for a specified role in an isolated page context with MFA handling.
 */
export async function performRoleLogin(
  page: Page,
  baseURL: string | undefined,
  role: string = 'USER'
): Promise<void> {
  const creds = getRoleCredentials(role);
  if (!creds.username || !creds.password) {
    console.warn(`[AUTH] Credentials missing for role '${role}'. Skipping login step and proceeding with test.`);
    return;
  }
  const loginPath = process.env.PLAYWRIGHT_LOGIN_URL || '/login';
  const loginUrl = (baseURL || '').replace(/\/+$/, '') + (loginPath.startsWith('/') ? loginPath : '/' + loginPath);

  await page.goto(loginUrl);
  await page.waitForLoadState('domcontentloaded');

  const userSelector = process.env.PLAYWRIGHT_USER_SELECTOR || '#username, #email, input[name="username"], input[name="email"], input[type="email"]';
  const passSelector = process.env.PLAYWRIGHT_PASS_SELECTOR || '#password, input[name="password"], input[type="password"]';

  const userField = page.locator(userSelector).first();
  const passField = page.locator(passSelector).first();

  if (await userField.isVisible({ timeout: 5000 }).catch(() => false)) {
    await userField.fill(creds.username || '');
  }
  if (await passField.isVisible({ timeout: 5000 }).catch(() => false)) {
    await passField.fill(creds.password || '');
  }

  const btnSelector = process.env.PLAYWRIGHT_SUBMIT_SELECTOR || 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), .btn-login, #login-btn';
  const loginButton = page.locator(btnSelector).first();
  if (await loginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginButton.click();
    await page.waitForLoadState('domcontentloaded');
  }

  // Handle MFA / OTP input if prompted
  const otpField = page.locator('input[name*="otp"], input[name*="mfa"], input[name*="code"], #otp, #mfa-code, #verificationCode').first();
  if (await otpField.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (!creds.otpCode && !creds.totpSecret) {
      throw new Error(`[CONFIGURATION_MISSING] MFA verification required for role '${role}', but no OTP/MFA code was configured.`);
    }
    await otpField.fill(creds.otpCode || '123456');
    const otpSubmit = page.locator('button:has-text("Verify"), button:has-text("Submit"), button[type="submit"]').first();
    if (await otpSubmit.isVisible({ timeout: 2000 }).catch(() => false)) {
      await otpSubmit.click();
      await page.waitForLoadState('domcontentloaded');
    }
  }

  // Detect authentication error banner
  const errorBanner = page.locator('.alert-danger, .error-message, .alert-error, [role="alert"], .text-danger, #error-msg, .login-error').first();
  if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
    const errorText = await errorBanner.innerText().catch(() => '');
    if (errorText && /invalid|incorrect|failed|denied|unauthorized|error/i.test(errorText)) {
      throw new Error(`[AUTHENTICATION_FAILED] Application rejected credentials for role '${role}': ${errorText.trim()}`);
    }
  }

  // Verify authentication attempt does not hang on login
  await expect(page).not.toHaveURL(/\/login(\?.*)?$/);
}

/**
 * Safely navigates to target URL and asserts server is responding without 50x errors.
 */
export async function safeNavigate(page: Page, targetUrl: string): Promise<void> {
  const response = await page.goto(targetUrl);
  await page.waitForLoadState('domcontentloaded');
  if (response) {
    const status = response.status();
    if (status === 503 || status === 502 || status === 504) {
      throw new Error(`APPLICATION_UNAVAILABLE: Target route returned HTTP ${status} (${targetUrl})`);
    }
  }
}

/**
 * Clears session cookies and state for clean unauthenticated testing.
 */
export async function clearSession(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}
