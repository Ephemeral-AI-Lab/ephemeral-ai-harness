import { bootstrap, type CodingAgent } from "../bootstrap.js";

export function main(configRoot?: string): CodingAgent {
  return bootstrap(configRoot);
}
