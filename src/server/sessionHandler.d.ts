declare module "*.mjs" {
  import type { VercelRequest, VercelResponse } from "@vercel/node";
  const handler: (request: VercelRequest, response: VercelResponse) => Promise<void>;
  export default handler;
}
