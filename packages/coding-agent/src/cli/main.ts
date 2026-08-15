import { bootstrap, type CodingAgent } from "../bootstrap.js";

export async function main(configRoot?: string): Promise<CodingAgent> {
  return bootstrap(configRoot);
}
