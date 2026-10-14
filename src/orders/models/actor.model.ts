export interface Actor {
  id?: string | null;
  /** Label for automatic actions, e.g. "system:expiry" or "mpesa". */
  label?: string;
}
