export interface Env {
  MY_VARIABLE: string;
}

const handler: ExportedHandler<Env> = {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        name: "Cloudflare",
      });
    }

    return new Response(null, { status: 404 });
  },
};

export default handler;
