export type SteerResult =
  | { accepted: true }
  | { accepted: false; reason: string };
