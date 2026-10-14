export interface FieldError {
  field: string;
  message: string;
}

/** RFC 7807 problem details. `errors` is present for validation failures. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  code?: string;
  errors?: FieldError[];
}
