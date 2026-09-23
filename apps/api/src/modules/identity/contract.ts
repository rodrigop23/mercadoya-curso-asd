export type IdentitySession = {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    role?: string | null;
  };
};

export type AdminAuthorization = { allowed: true } | { allowed: false; status: 401 | 403 };

export interface IdentityContract {
  getSession(headers: Headers): Promise<IdentitySession | null>;
  requireAdmin(headers: Headers): Promise<AdminAuthorization>;
}
