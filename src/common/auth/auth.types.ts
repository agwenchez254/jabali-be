export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}
