export type FormatEngineErrorCode =
  | "too_few_participants"
  | "unknown_match"
  | "invalid_result"
  | "draw_not_allowed";

export class FormatEngineError extends Error {
  readonly code: FormatEngineErrorCode;

  constructor(code: FormatEngineErrorCode, message: string) {
    super(message);
    this.name = "FormatEngineError";
    this.code = code;
  }
}
