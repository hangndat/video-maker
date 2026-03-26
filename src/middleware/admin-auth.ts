import type { NextFunction, Request, Response } from 'express';

export function getAdminApiToken(): string | undefined {
  const t = process.env.ADMIN_API_TOKEN?.trim();
  return t || undefined;
}

/** When unset, admin API and static /admin are not mounted (see create-app). */
export function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getAdminApiToken();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Admin is not configured' });
    return;
  }
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : undefined;
  if (!token || token !== expected) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}
