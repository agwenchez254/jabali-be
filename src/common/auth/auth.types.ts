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

/** What a verified customer access token tells the API about the caller. */
export interface CustomerAuthUser {
  accountId: string;
  customerId: string;
  email: string;
  name: string;
}

/** Customer access-token claims. `typ` keeps these tokens out of the staff guard (same signing secret). */
export interface CustomerTokenPayload {
  sub: string;
  typ: 'customer';
  cid: string;
  email: string;
  name: string;
}
